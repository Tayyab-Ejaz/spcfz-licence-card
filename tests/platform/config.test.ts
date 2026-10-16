import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { DEFAULT_PORT, DEFAULT_TRUST_PROXY, loadConfig, parseEnvFile, readConfig } from '../../src/platform/config.js';
import { tempDir } from '../env.js';

const dir = tempDir('spcfz-config-');
afterAll(() => rmSync(dir, { recursive: true, force: true }));

const MINIMAL = { BASE_URL: 'https://licensed.spcfz.ae', DATA_DIR: path.join(dir, 'data') };

describe('parseEnvFile', () => {
  it('reads KEY=value lines, comments, quotes and export', () => {
    const out = parseEnvFile([
      '# comment',
      '',
      'A=1',
      'export B=two words',
      "C='single quoted # not a comment'",
      'D="double \\"quoted\\"\\nline"',
      'E=value # trailing comment',
      'F=',
      'not a line',
      '1BAD=x',
    ].join('\n'));
    expect(out).toEqual({ A: '1', B: 'two words', C: 'single quoted # not a comment', D: 'double "quoted"\nline', E: 'value', F: '' });
  });
});

describe('readConfig', () => {
  it('requires BASE_URL and DATA_DIR and reports every problem at once', () => {
    const r = readConfig({ PORT: 'abc', TRUST_PROXY: 'maybe', FIELD_MAP: '[1]' });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.errors.some((e) => e.startsWith('BASE_URL'))).toBe(true);
      expect(r.errors.some((e) => e.startsWith('DATA_DIR'))).toBe(true);
      expect(r.errors.some((e) => e.startsWith('PORT'))).toBe(true);
      expect(r.errors.some((e) => e.startsWith('TRUST_PROXY'))).toBe(true);
      expect(r.errors.some((e) => e.startsWith('FIELD_MAP'))).toBe(true);
      expect(r.errors).toHaveLength(5);
    }
  });

  it('applies defaults, strips the trailing slash from BASE_URL and resolves DATA_DIR', () => {
    const r = readConfig({ ...MINIMAL, BASE_URL: 'https://licensed.spcfz.ae/' });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.config.port).toBe(DEFAULT_PORT);
      expect(r.config.host).toBe('127.0.0.1');
      expect(r.config.trustProxy).toBe(DEFAULT_TRUST_PROXY);
      expect(r.config.vars.BASE_URL).toBe('https://licensed.spcfz.ae');
      expect(r.config.vars.DATA_DIR).toBe(path.resolve(MINIMAL.DATA_DIR));
      expect(r.config.vars.PORT).toBe(DEFAULT_PORT);
      expect(r.config.vars.TRUST_PROXY).toBe(DEFAULT_TRUST_PROXY);
      expect(r.config.vars.FIELD_MAP).toBe('{}');
      expect(r.config.vars.TEMPLATE_VERSION).toBe('placeholder-1');
      expect(r.config.vars.ERP_IP_ALLOWLIST).toBe('');
      expect(r.config.vars.WEBHOOK_SECRET_CURRENT).toBeUndefined();
      expect(r.config.warnings.some((w) => w.includes('ERP_IP_ALLOWLIST'))).toBe(true);
      expect(r.config.warnings.some((w) => w.includes('WEBHOOK_SECRET_CURRENT'))).toBe(true);
      expect(r.config.warnings.some((w) => w.includes('ACCESS_TEAM_DOMAIN'))).toBe(true);
    }
  });

  it('validates PORT, TRUST_PROXY, BASE_URL scheme and CHROME_PATH', () => {
    expect(readConfig({ ...MINIMAL, PORT: '0' }).ok).toBe(true);
    expect(readConfig({ ...MINIMAL, PORT: '65535' }).ok).toBe(true);
    expect(readConfig({ ...MINIMAL, PORT: '65536' }).ok).toBe(false);
    expect(readConfig({ ...MINIMAL, PORT: '-1' }).ok).toBe(false);
    for (const mode of ['off', 'cloudflare', 'local-proxy', 'Local-Proxy']) {
      const r = readConfig({ ...MINIMAL, TRUST_PROXY: mode });
      expect(r.ok, mode).toBe(true);
      if (r.ok) expect(r.config.trustProxy).toBe(mode.toLowerCase());
    }
    expect(readConfig({ ...MINIMAL, TRUST_PROXY: 'yes' }).ok).toBe(false);
    expect(readConfig({ ...MINIMAL, BASE_URL: 'ftp://x' }).ok).toBe(false);
    expect(readConfig({ ...MINIMAL, BASE_URL: 'licensed.spcfz.ae' }).ok).toBe(false);
    expect(readConfig({ ...MINIMAL, CHROME_PATH: path.join(dir, 'no-such-chrome') }).ok).toBe(false);
    const withChrome = readConfig({ ...MINIMAL, CHROME_PATH: process.execPath });
    expect(withChrome.ok).toBe(true);
    if (withChrome.ok) expect(withChrome.config.vars.CHROME_PATH).toBe(process.execPath);
  });

  it('treats blank values as unset', () => {
    const r = readConfig({ ...MINIMAL, WEBHOOK_SECRET_PREVIOUS: '   ', PORT: '', TRUST_PROXY: '' });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.config.vars.WEBHOOK_SECRET_PREVIOUS).toBeUndefined();
      expect(r.config.port).toBe(DEFAULT_PORT);
    }
  });
});

describe('loadConfig', () => {
  it('merges a .env file under the environment, which always wins', () => {
    const envFile = path.join(dir, 'a.env');
    mkdirSync(dir, { recursive: true });
    writeFileSync(envFile, 'BASE_URL=https://from-file.test\nDATA_DIR=./data-from-file\nPORT=9000\nTRUST_PROXY=off\n');
    const config = loadConfig({ envFile, source: { PORT: '9100' } });
    expect(config.envFile).toBe(envFile);
    expect(config.vars.BASE_URL).toBe('https://from-file.test');
    expect(config.port).toBe(9100);
    expect(config.trustProxy).toBe('off');
  });

  it('exits with every error listed when the configuration is unusable', () => {
    const lines: string[] = [];
    expect(() =>
      loadConfig({
        envFile: path.join(dir, 'missing.env'),
        source: { DATA_DIR: MINIMAL.DATA_DIR },
        stderr: (l) => lines.push(l),
        exit: (code) => {
          throw new Error(`exit ${code}`);
        },
      }),
    ).toThrow('exit 1');
    expect(lines.join('\n')).toContain('BASE_URL is required');
  });
});
