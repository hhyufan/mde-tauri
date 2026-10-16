import { useEffect, useState } from 'react';
import { FileTextOutlined, CheckCircleOutlined } from '@ant-design/icons';
import useDemoComplete from './useDemoComplete';

// A local language-service demonstration; no server or document access in setup.
export default function LanguageDemo({ onComplete }) {
  const [step, setStep] = useState(0);
  useEffect(() => {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      setStep(2);
      return;
    }
    const timers = [setTimeout(() => setStep(1), 1400), setTimeout(() => setStep(2), 4300)];
    return () => timers.forEach(clearTimeout);
  }, []);
  useDemoComplete(step === 2, onComplete);
  return (
    <div
      className="scene-language-demo"
      data-complete={step === 2}
      aria-label="Markdown 链接补全与诊断演示"
    >
      <div className="scene-language-source">
        <div>
          <span className="scene-line-number">1</span>
          <span className="scene-token-heading"># 我的阅读清单</span>
        </div>
        <div>
          <span className="scene-line-number">2</span>
        </div>
        <div>
          <span className="scene-line-number">3</span>
          <span>
            继续阅读 <span className="scene-link-text">[阅读笔记]</span>(
            <span className={step === 0 ? 'scene-link-diagnostic' : 'scene-link-path'}>
              {step === 2 ? './notes.md' : './no'}
            </span>
            {step === 2 ? ')' : <i className="scene-typing-caret" />}
          </span>
        </div>
      </div>
      {step < 2 && (
        <div className={`scene-completions${step === 0 ? ' is-waiting' : ''}`}>
          <div className="scene-completion-row is-selected">
            <FileTextOutlined />
            <span>
              <b>no</b>tes.md
            </span>
            <small>文档</small>
          </div>
          <div className="scene-completion-row">
            <FileTextOutlined />
            <span>
              <b>no</b>tebook.md
            </span>
            <small>文档</small>
          </div>
          <div className="scene-completion-detail">
            阅读笔记 <span>Enter ↵</span>
          </div>
        </div>
      )}
      <div className={`scene-language-message${step === 2 ? ' is-resolved' : ''}`}>
        {step === 2 ? (
          <>
            <CheckCircleOutlined />
            <span>链接已补全 · 文档引用有效</span>
          </>
        ) : step === 1 ? (
          <>
            <FileTextOutlined />
            <span>选择文档，补全相对路径</span>
          </>
        ) : (
          <>
            <span className="scene-diagnostic-dot" />
            <span>检查文档引用与链接路径</span>
          </>
        )}
      </div>
      <div className="scene-editor-footer">
        <span>Markdown · 语言服务演示</span>
        <span>UTF-8 · LF</span>
      </div>
    </div>
  );
}
