import { ChevronDown, Settings2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import type { ToolKind } from '../types';
import {
  defaultRunConfig, loadRunConfig, saveRunConfig, type PlaywrightRunOptions, type RunConfigState, usesPlaywrightFields,
} from '../tool-options';
import { cn, Select } from './ui';

const darkField = 'rounded-lg border border-slate-700 bg-slate-900 px-2 py-1.5 text-xs text-slate-100 focus:border-blue-500 focus:outline-none';
const darkLabel = 'text-[11px] text-slate-400';

function Field({
  label, children, className,
}: { label: string; children: React.ReactNode; className?: string }) {
  return (
    <label className={cn('flex min-w-[9rem] flex-col gap-1', className)}>
      <span className={darkLabel}>{label}</span>
      {children}
    </label>
  );
}

function NumberInput({
  value, onChange, min, max, step = 1,
}: { value: number; onChange: (value: number) => void; min?: number; max?: number; step?: number }) {
  return (
    <input
      type="number"
      className={darkField}
      value={value}
      min={min}
      max={max}
      step={step}
      onChange={event => onChange(Number(event.target.value))}
      dir="ltr"
    />
  );
}

function Checkbox({
  checked, onChange, label,
}: { checked: boolean; onChange: (value: boolean) => void; label: string }) {
  return (
    <label className="inline-flex items-center gap-2 text-xs text-slate-300">
      <input type="checkbox" checked={checked} onChange={event => onChange(event.target.checked)} className="rounded border-slate-600" />
      {label}
    </label>
  );
}

function PlaywrightFields({
  config, onChange,
}: {
  config: RunConfigState;
  onChange: (next: RunConfigState) => void;
}) {
  const opts = config.toolOptions as PlaywrightRunOptions;
  const toggleBrowser = (browser: 'chromium' | 'firefox' | 'webkit') => {
    const set = new Set(config.browserProjects);
    if (set.has(browser)) {
      if (set.size > 1) set.delete(browser);
    } else {
      set.add(browser);
    }
    onChange({ ...config, browserProjects: [...set] as RunConfigState['browserProjects'] });
  };
  return (
    <div className="flex flex-wrap gap-3">
      <Field label="مرورگر">
        <div className="flex flex-wrap gap-2 pt-0.5">
          {(['chromium', 'firefox', 'webkit'] as const).map(browser => (
            <Checkbox
              key={browser}
              checked={config.browserProjects.includes(browser)}
              onChange={() => toggleBrowser(browser)}
              label={browser}
            />
          ))}
        </div>
      </Field>
      <Field label="کانال">
        <select className={darkField} value={opts.channel} onChange={event => onChange({ ...config, toolOptions: { ...opts, channel: event.target.value as PlaywrightRunOptions['channel'] } })}>
          <option value="chrome">Chrome</option>
          <option value="msedge">Edge</option>
          <option value="chromium">Chromium</option>
        </select>
      </Field>
      <Field label="ورکر">
        <NumberInput value={config.workers} min={1} max={32} onChange={workers => onChange({ ...config, workers })} />
      </Field>
      <Field label="ریترای">
        <NumberInput value={config.retries} min={0} max={10} onChange={retries => onChange({ ...config, retries })} />
      </Field>
      <Field label="Trace">
        <select className={darkField} value={config.trace} onChange={event => onChange({ ...config, trace: event.target.value as RunConfigState['trace'] })}>
          <option value="off">off</option>
          <option value="on">on</option>
          <option value="retain-on-failure">retain-on-failure</option>
          <option value="on-first-retry">on-first-retry</option>
        </select>
      </Field>
      <Field label="Reporter">
        <select className={darkField} value={config.reporter} onChange={event => onChange({ ...config, reporter: event.target.value as RunConfigState['reporter'] })}>
          <option value="json">json</option>
          <option value="html">html</option>
          <option value="junit">junit</option>
        </select>
      </Field>
      <Field label="تایم‌اوت تست (ms)">
        <NumberInput value={opts.testTimeoutMs} min={1000} max={3600000} step={1000} onChange={testTimeoutMs => onChange({ ...config, toolOptions: { ...opts, testTimeoutMs } })} />
      </Field>
      <Field label="تایم‌اوت اکشن (ms)">
        <NumberInput value={opts.actionTimeoutMs} min={500} max={600000} step={500} onChange={actionTimeoutMs => onChange({ ...config, toolOptions: { ...opts, actionTimeoutMs } })} />
      </Field>
      <Field label="تایم‌اوت ناوبری (ms)">
        <NumberInput value={opts.navigationTimeoutMs} min={1000} max={600000} step={500} onChange={navigationTimeoutMs => onChange({ ...config, toolOptions: { ...opts, navigationTimeoutMs } })} />
      </Field>
      <Field label="تایم‌اوت کل (ثانیه)" className="min-w-[8rem]">
        <NumberInput value={config.timeoutSeconds} min={5} max={3600} onChange={timeoutSeconds => onChange({ ...config, timeoutSeconds })} />
      </Field>
      <Field label="هدر HTTP (JSON)" className="min-w-full flex-1">
        <textarea
          className={cn(darkField, 'min-h-[3rem] font-mono')}
          value={opts.extraHeaders}
          placeholder='{"Authorization":"Bearer ..."}'
          onChange={event => onChange({ ...config, toolOptions: { ...opts, extraHeaders: event.target.value } })}
          dir="ltr"
        />
      </Field>
      <div className="flex flex-wrap items-center gap-4 pt-4">
        <Checkbox checked={config.headed} onChange={headed => onChange({ ...config, headed })} label="headed (نمایش مرورگر)" />
      </div>
    </div>
  );
}

function ToolSpecificFields({
  tool, config, onChange,
}: {
  tool: ToolKind;
  config: RunConfigState;
  onChange: (next: RunConfigState) => void;
}) {
  const opts = config.toolOptions as Record<string, unknown>;
  const patch = (patchOpts: Record<string, unknown>) => onChange({ ...config, toolOptions: { ...opts, ...patchOpts } });

  if (tool === 'PLAYWRIGHT') return <PlaywrightFields config={config} onChange={onChange} />;

  if (tool === 'AXE') {
    const axe = opts as { channel: string; wcagTags: string[]; disableRules: string; includeTags: string };
    const tagText = (axe.wcagTags || []).join(', ');
    return (
      <div className="flex flex-wrap gap-3">
        <Field label="کانال">
          <select className={darkField} value={axe.channel} onChange={event => patch({ channel: event.target.value })}>
            <option value="chrome">Chrome</option>
            <option value="msedge">Edge</option>
            <option value="chromium">Chromium</option>
          </select>
        </Field>
        <Field label="WCAG tags" className="min-w-[14rem]">
          <input className={darkField} value={tagText} dir="ltr" onChange={event => patch({ wcagTags: event.target.value.split(',').map(item => item.trim()).filter(Boolean) })} placeholder="wcag2a, wcag2aa" />
        </Field>
        <Field label="disable rules" className="min-w-[12rem]">
          <input className={darkField} value={axe.disableRules} dir="ltr" onChange={event => patch({ disableRules: event.target.value })} placeholder="color-contrast" />
        </Field>
        <Field label="include tags" className="min-w-[12rem]">
          <input className={darkField} value={axe.includeTags} dir="ltr" onChange={event => patch({ includeTags: event.target.value })} />
        </Field>
        <Checkbox checked={config.headed} onChange={headed => onChange({ ...config, headed })} label="headed" />
        <Field label="تایم‌اوت (ثانیه)">
          <NumberInput value={config.timeoutSeconds} min={5} max={3600} onChange={timeoutSeconds => onChange({ ...config, timeoutSeconds })} />
        </Field>
      </div>
    );
  }

  if (tool === 'K6') {
    const k6 = opts as { vus: number; duration: string; iterations: number | null; httpDebug: boolean; insecureSkipTlsVerify: boolean };
    return (
      <div className="flex flex-wrap gap-3">
        <Field label="VUs"><NumberInput value={k6.vus} min={1} max={500} onChange={vus => patch({ vus })} /></Field>
        <Field label="Duration"><input className={darkField} dir="ltr" value={k6.duration} onChange={event => patch({ duration: event.target.value })} placeholder="30s" /></Field>
        <Field label="Iterations"><input className={darkField} dir="ltr" value={k6.iterations ?? ''} onChange={event => patch({ iterations: event.target.value ? Number(event.target.value) : null })} placeholder="اختیاری" /></Field>
        <Field label="تایم‌اوت (ثانیه)"><NumberInput value={config.timeoutSeconds} min={5} max={3600} onChange={timeoutSeconds => onChange({ ...config, timeoutSeconds })} /></Field>
        <div className="flex flex-wrap gap-4 pt-4">
          <Checkbox checked={k6.httpDebug} onChange={httpDebug => patch({ httpDebug })} label="http-debug" />
          <Checkbox checked={k6.insecureSkipTlsVerify} onChange={insecureSkipTlsVerify => patch({ insecureSkipTlsVerify })} label="insecure-skip-tls-verify" />
        </div>
      </div>
    );
  }

  if (tool === 'DANGER') {
    const danger = opts as { requestTimeoutMs: number; bailOnFirstFailure: boolean };
    return (
      <div className="flex flex-wrap gap-3">
        <Field label="تایم‌اوت درخواست (ms)"><NumberInput value={danger.requestTimeoutMs} min={1000} max={600000} step={1000} onChange={requestTimeoutMs => patch({ requestTimeoutMs })} /></Field>
        <Field label="تایم‌اوت کل (ثانیه)"><NumberInput value={config.timeoutSeconds} min={5} max={3600} onChange={timeoutSeconds => onChange({ ...config, timeoutSeconds })} /></Field>
        <Checkbox checked={danger.bailOnFirstFailure} onChange={bailOnFirstFailure => patch({ bailOnFirstFailure })} label="توقف در اولین FAIL" />
      </div>
    );
  }

  if (tool === 'VITEST') {
    const vitest = opts as { bail: boolean; coverage: boolean; pool: string; reporter: string; passWithNoTests: boolean };
    return (
      <div className="flex flex-wrap gap-3">
        <Field label="Pool">
          <select className={darkField} value={vitest.pool} onChange={event => patch({ pool: event.target.value })}>
            <option value="threads">threads</option>
            <option value="forks">forks</option>
          </select>
        </Field>
        <Field label="Reporter">
          <select className={darkField} value={vitest.reporter} onChange={event => patch({ reporter: event.target.value })}>
            <option value="default">default</option>
            <option value="verbose">verbose</option>
            <option value="json">json</option>
          </select>
        </Field>
        <Field label="تایم‌اوت (ثانیه)"><NumberInput value={config.timeoutSeconds} min={5} max={3600} onChange={timeoutSeconds => onChange({ ...config, timeoutSeconds })} /></Field>
        <div className="flex flex-wrap gap-4 pt-4">
          <Checkbox checked={vitest.bail} onChange={bail => patch({ bail })} label="bail" />
          <Checkbox checked={vitest.coverage} onChange={coverage => patch({ coverage })} label="coverage" />
          <Checkbox checked={vitest.passWithNoTests} onChange={passWithNoTests => patch({ passWithNoTests })} label="passWithNoTests" />
        </div>
      </div>
    );
  }

  if (tool === 'BIOME') {
    const biome = opts as { formatterEnabled: boolean; maxDepth: number };
    return (
      <div className="flex flex-wrap gap-3">
        <Field label="عمق اسکن"><NumberInput value={biome.maxDepth} min={1} max={12} onChange={maxDepth => patch({ maxDepth })} /></Field>
        <Field label="تایم‌اوت (ثانیه)"><NumberInput value={config.timeoutSeconds} min={5} max={3600} onChange={timeoutSeconds => onChange({ ...config, timeoutSeconds })} /></Field>
        <Checkbox checked={biome.formatterEnabled} onChange={formatterEnabled => patch({ formatterEnabled })} label="formatter فعال" />
      </div>
    );
  }

  if (tool === 'GITLEAKS') {
    const gitleaks = opts as { verbose: boolean; redact: boolean };
    return (
      <div className="flex flex-wrap gap-3">
        <Field label="تایم‌اوت (ثانیه)"><NumberInput value={config.timeoutSeconds} min={5} max={3600} onChange={timeoutSeconds => onChange({ ...config, timeoutSeconds })} /></Field>
        <Checkbox checked={gitleaks.verbose} onChange={verbose => patch({ verbose })} label="verbose" />
        <Checkbox checked={gitleaks.redact} onChange={redact => patch({ redact })} label="redact secrets" />
      </div>
    );
  }

  if (tool === 'AUDIT') {
    const audit = opts as { failOn: string; includeDev: boolean; runExtras: boolean };
    return (
      <div className="flex flex-wrap gap-3">
        <Field label="شکست از سطح">
          <select className={darkField} value={audit.failOn} onChange={event => patch({ failOn: event.target.value })}>
            <option value="high">high/critical</option>
            <option value="moderate">moderate+</option>
            <option value="low">low+</option>
          </select>
        </Field>
        <Field label="تایم‌اوت (ثانیه)"><NumberInput value={config.timeoutSeconds} min={5} max={3600} onChange={timeoutSeconds => onChange({ ...config, timeoutSeconds })} /></Field>
        <Checkbox checked={audit.includeDev} onChange={includeDev => patch({ includeDev })} label="شامل devDependencies" />
        <Checkbox checked={audit.runExtras} onChange={runExtras => patch({ runExtras })} label="osv-scanner / trivy" />
      </div>
    );
  }

  if (tool === 'SEMGREP') {
    const semgrep = opts as { configPath: string; severity: string };
    return (
      <div className="flex flex-wrap gap-3">
        <Field label="مسیر config" className="min-w-[14rem]"><input className={darkField} dir="ltr" value={semgrep.configPath} onChange={event => patch({ configPath: event.target.value })} placeholder="apps/runner/quality/semgrep.yml" /></Field>
        <Field label="Severity">
          <select className={darkField} value={semgrep.severity} onChange={event => patch({ severity: event.target.value })}>
            <option value="ERROR">ERROR</option>
            <option value="WARNING">WARNING</option>
          </select>
        </Field>
        <Field label="تایم‌اوت (ثانیه)"><NumberInput value={config.timeoutSeconds} min={5} max={3600} onChange={timeoutSeconds => onChange({ ...config, timeoutSeconds })} /></Field>
      </div>
    );
  }

  if (tool === 'SPECTRAL') {
    const spectral = opts as { rulesetPath: string; failSeverity: string };
    return (
      <div className="flex flex-wrap gap-3">
        <Field label="مسیر ruleset" className="min-w-[14rem]"><input className={darkField} dir="ltr" value={spectral.rulesetPath} onChange={event => patch({ rulesetPath: event.target.value })} placeholder=".spectral.yaml" /></Field>
        <Field label="Fail severity">
          <select className={darkField} value={spectral.failSeverity} onChange={event => patch({ failSeverity: event.target.value })}>
            <option value="error">error</option>
            <option value="warn">warn</option>
            <option value="hint">hint</option>
            <option value="info">info</option>
          </select>
        </Field>
        <Field label="تایم‌اوت (ثانیه)"><NumberInput value={config.timeoutSeconds} min={5} max={3600} onChange={timeoutSeconds => onChange({ ...config, timeoutSeconds })} /></Field>
      </div>
    );
  }

  return null;
}

export function ToolRunOptionsPanel({
  tool, config, onChange, defaultOpen = false,
}: {
  tool: ToolKind;
  config: RunConfigState;
  onChange: (next: RunConfigState) => void;
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="rounded-xl border border-slate-800 bg-slate-950/60">
      <button
        type="button"
        onClick={() => setOpen(current => !current)}
        className="flex w-full items-center gap-2 px-3 py-2 text-right text-xs text-slate-300 hover:bg-white/5"
      >
        <Settings2 className="h-3.5 w-3.5 text-slate-500" />
        <span className="font-medium">تنظیمات {usesPlaywrightFields(tool) ? 'Playwright' : tool}</span>
        <ChevronDown className={cn('ms-auto h-4 w-4 transition', open && 'rotate-180')} />
      </button>
      {open && (
        <div className="border-t border-slate-800 px-3 py-3">
          <ToolSpecificFields tool={tool} config={config} onChange={onChange} />
        </div>
      )}
    </div>
  );
}

export function useToolRunConfig(tool: ToolKind) {
  const [config, setConfig] = useState<RunConfigState>(() => loadRunConfig(tool));

  useEffect(() => {
    setConfig(loadRunConfig(tool));
  }, [tool]);

  useEffect(() => {
    saveRunConfig(tool, config);
  }, [tool, config]);

  function resetConfig() {
    setConfig(defaultRunConfig(tool));
  }

  return { config, setConfig, resetConfig };
}

export function ToolRunOptions({
  tool, onChange,
}: {
  tool: ToolKind;
  onChange: (config: RunConfigState) => void;
}) {
  const { config, setConfig } = useToolRunConfig(tool);

  useEffect(() => {
    onChange(config);
  }, [config, onChange]);

  return (
    <ToolRunOptionsPanel
      tool={tool}
      config={config}
      onChange={next => {
        setConfig(next);
        onChange(next);
      }}
    />
  );
}
