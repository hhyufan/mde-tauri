import { existsSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const versionsDescending = (a, b) => b.localeCompare(a, 'en', { numeric: true });
const directories = (directory) => {
  try {
    return readdirSync(directory, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .sort(versionsDescending);
  } catch {
    return [];
  }
};

// vswhere's isComplete describes the installer, not the actual C++ toolchain files.
export function findCompleteToolchain(installations, arch = 'x64') {
  for (const installation of installations) {
    const vcvars = path.join(installation, 'VC', 'Auxiliary', 'Build', 'vcvarsall.bat');
    if (!existsSync(vcvars)) continue;
    const tools = path.join(installation, 'VC', 'Tools', 'MSVC');
    for (const version of directories(tools)) {
      const root = path.join(tools, version);
      const compiler = path.join(root, 'bin', 'Hostx64', arch, 'cl.exe');
      const linker = path.join(root, 'bin', 'Hostx64', arch, 'link.exe');
      if (
        [
          compiler,
          linker,
          path.join(root, 'include', 'vcruntime.h'),
          path.join(root, 'lib', arch, 'libcmt.lib'),
        ].every(existsSync)
      ) {
        return { installation, vcvars, root, version, compiler, linker, arch };
      }
    }
  }
  return null;
}

export function parseDeveloperEnvironment(output) {
  const env = {};
  for (const line of output.split(/\r?\n/)) {
    const separator = line.indexOf('=');
    if (separator <= 0) continue;
    env[line.slice(0, separator)] = line.slice(separator + 1);
  }
  return env;
}

export function discoverVisualStudio(env = process.env) {
  const programRoots = [...new Set([env['ProgramFiles(x86)'], env.ProgramFiles].filter(Boolean))];
  const installations = [];
  for (const programRoot of programRoots) {
    const vswhere = path.join(programRoot, 'Microsoft Visual Studio', 'Installer', 'vswhere.exe');
    if (!existsSync(vswhere)) continue;
    const result = spawnSync(vswhere, ['-all', '-products', '*', '-format', 'json', '-utf8'], {
      encoding: 'utf8',
      windowsHide: true,
      timeout: 15_000,
    });
    if (result.status === 0) {
      try {
        installations.push(
          ...JSON.parse(result.stdout.replace(/^\uFEFF/, ''))
            .sort((a, b) => versionsDescending(a.installationVersion, b.installationVersion))
            .map((instance) => instance.installationPath)
            .filter(Boolean),
        );
      } catch {
        /* Fall back to the standard installation directories. */
      }
    }
    break;
  }
  for (const programRoot of programRoots) {
    const root = path.join(programRoot, 'Microsoft Visual Studio');
    for (const version of directories(root)) {
      for (const edition of ['BuildTools', 'Community', 'Professional', 'Enterprise']) {
        installations.push(path.join(root, version, edition));
      }
    }
  }
  return [...new Set(installations)];
}

export function initializeMsvc(args, env = process.env) {
  if (
    process.platform !== 'win32' ||
    !['build', 'dev'].includes(args[0]) ||
    args.includes('--help') ||
    args.includes('-h')
  )
    return;
  const targetIndex = args.indexOf('--target');
  const target =
    targetIndex >= 0
      ? args[targetIndex + 1]
      : args.find((arg) => arg.startsWith('--target='))?.slice('--target='.length);
  if (target && !target.endsWith('-windows-msvc')) return;
  const rustArch =
    target?.split('-')[0] || { x64: 'x86_64', arm64: 'aarch64', ia32: 'i686' }[process.arch];
  const arch = { x86_64: 'x64', aarch64: 'arm64', i686: 'x86' }[rustArch];
  if (!arch) return;
  const toolchain = findCompleteToolchain(discoverVisualStudio(env), arch);
  if (!toolchain) {
    throw new Error(
      '没有找到完整的 MSVC C++ 工具链。请在 Visual Studio Installer 中安装“使用 C++ 的桌面开发”和 Windows SDK。',
    );
  }
  // Only this discovered local batch path enters cmd; Tauri/user arguments never do.
  if (/["%!^&|<>\r\n]/.test(toolchain.vcvars))
    throw new Error('Visual Studio 安装路径包含无法安全调用的字符。');
  const architecture = arch === 'x64' ? 'amd64' : `amd64_${arch}`;
  const result = spawnSync(
    env.ComSpec || 'cmd.exe',
    [
      '/d',
      '/s',
      '/v:off',
      '/c',
      `chcp 65001 >nul && call "${toolchain.vcvars}" ${architecture} -vcvars_ver=${toolchain.version} >nul && set`,
    ],
    { encoding: 'utf8', windowsHide: true, windowsVerbatimArguments: true, timeout: 30_000, env },
  );
  if (result.error || result.status !== 0) {
    throw new Error(
      `MSVC 开发环境初始化失败：${result.error?.message || result.stderr.trim() || result.status}`,
    );
  }
  const developerEnv = parseDeveloperEnvironment(result.stdout);
  if (!developerEnv.INCLUDE || !developerEnv.LIB)
    throw new Error('MSVC 开发环境未提供 INCLUDE/LIB。');
  Object.assign(env, developerEnv);
  const cargoTarget = `${rustArch}_pc_windows_msvc`;
  env[`CC_${cargoTarget}`] = toolchain.compiler;
  env[`CXX_${cargoTarget}`] = toolchain.compiler;
  env[`CARGO_TARGET_${cargoTarget.toUpperCase()}_LINKER`] = toolchain.linker;
  console.log(`[mde] MSVC ${toolchain.version} (${arch}): ${toolchain.installation}`);
}
