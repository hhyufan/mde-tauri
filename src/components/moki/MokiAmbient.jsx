// Small, deterministic ornaments stay around the illustration rather than over it.
// 动画常驻：是否真正播放交给系统偏好（见 moki.scss 的 prefers-reduced-motion 分支）。
// 应用内不再提供开关——它只在欢迎页生效，不值得让用户单独关一次。
const symbols = [
  ['#', '8%', '16%', '15s', '-2s', '-14px', '-36px', '-12deg'],
  ['</>', '84%', '20%', '18s', '-9s', '12px', '-30px', '10deg'],
  ['**', '2%', '55%', '17s', '-6s', '-12px', '-38px', '-8deg'],
  ['[]', '88%', '62%', '20s', '-13s', '10px', '-40px', '14deg'],
  ['{}', '18%', '84%', '19s', '-3s', '-18px', '-34px', '-10deg'],
  ['+', '74%', '88%', '16s', '-11s', '15px', '-35px', '12deg'],
  ['✦', '50%', '4%', '21s', '-7s', '8px', '-22px', '18deg'],
  ['>_', '80%', '44%', '22s', '-16s', '14px', '-30px', '8deg'],
];
export default function MokiAmbient() {
  return (
    <div className="moki-ambient moki-ambient--animated" aria-hidden="true">
      {symbols.map(([text, x, y, duration, delay, dx, dy, tilt]) => (
        <span
          key={text}
          className="moki-ambient__symbol"
          style={{
            left: x,
            top: y,
            '--duration': duration,
            '--delay': delay,
            '--dx': dx,
            '--dy': dy,
            '--tilt': tilt,
          }}
        >
          {text}
        </span>
      ))}
    </div>
  );
}
