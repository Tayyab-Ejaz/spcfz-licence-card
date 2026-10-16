// Button, Input and Toast from the SPC Free Zone design system (Claude Design project 792df08b,
// bundle namespace SPCFreeZoneDesignSystem_792df0), copied verbatim from the bundle shipped inside the
// approved studio export. They are the only design-system components the studio imports.
import React from 'react';

const TOAST_TONES = {
  info: { bg: 'var(--spc-ink)', accent: 'var(--blue-400)' },
  success: { bg: 'var(--spc-ink)', accent: 'var(--success-500)' },
  danger: { bg: 'var(--spc-ink)', accent: 'var(--danger-500)' },
};
export function Toast({ children, tone = 'info', onClose }) {
  const t = TOAST_TONES[tone] || TOAST_TONES.info;
  return React.createElement('div', {
    style: {
      display: 'flex', alignItems: 'center', gap: 12, background: t.bg, color: '#fff', padding: '14px 18px',
      borderRadius: 'var(--radius-md)', borderLeft: `4px solid ${t.accent}`, boxShadow: 'var(--shadow-lg)',
      fontFamily: 'var(--font-sans)', fontSize: 14, maxWidth: 360,
    },
  }, React.createElement('span', { style: { flex: 1 } }, children),
  onClose && React.createElement('span', { onClick: onClose, style: { cursor: 'pointer', opacity: 0.7 } }, '×'));
}

const SIZES = { sm: { h: 36, fs: 13, px: 16 }, md: { h: 46, fs: 15, px: 24 }, lg: { h: 54, fs: 16, px: 30 } };
const VARIANTS = {
  primary: { bg: 'var(--brand-primary)', bgHover: 'var(--brand-primary-hover)', color: '#fff', border: 'none' },
  secondary: { bg: 'transparent', bgHover: 'var(--blue-50)', color: 'var(--brand-primary)', border: '1.5px solid var(--brand-primary)' },
  ghost: { bg: 'transparent', bgHover: 'var(--gray-100)', color: 'var(--text-heading)', border: 'none' },
  accent: { bg: 'var(--gold-500)', bgHover: 'var(--gold-600)', color: 'var(--spc-ink)', border: 'none' },
};
export function Button({ children, variant = 'primary', size = 'md', disabled = false, onClick, type = 'button' }) {
  const s = SIZES[size] || SIZES.md;
  const v = VARIANTS[variant] || VARIANTS.primary;
  const [hover, setHover] = React.useState(false);
  return React.createElement('button', {
    type, disabled, onClick,
    onMouseEnter: () => setHover(true),
    onMouseLeave: () => setHover(false),
    style: {
      height: s.h, fontSize: s.fs, padding: `0 ${s.px}px`,
      background: disabled ? 'var(--gray-200)' : hover ? v.bgHover : v.bg,
      color: disabled ? 'var(--gray-500)' : v.color,
      border: v.border, borderRadius: 'var(--radius-pill)', fontWeight: 700, fontFamily: 'var(--font-sans)',
      cursor: disabled ? 'not-allowed' : 'pointer', transition: 'background var(--duration-fast) var(--ease-standard)',
      display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 8,
    },
  }, children);
}

export function Input({ label, placeholder, type = 'text', value, onChange, error, helper }) {
  const [focus, setFocus] = React.useState(false);
  return React.createElement('div', {
    style: { display: 'flex', flexDirection: 'column', gap: 6, fontFamily: 'var(--font-sans)', width: '100%' },
  }, label && React.createElement('label', { style: { fontSize: 13, fontWeight: 600, color: 'var(--text-heading)' } }, label),
  React.createElement('input', {
    type, placeholder, value, onChange,
    onFocus: () => setFocus(true),
    onBlur: () => setFocus(false),
    style: {
      height: 46, borderRadius: 'var(--radius-md)',
      border: `1.5px solid ${error ? 'var(--danger-500)' : focus ? 'var(--brand-primary)' : 'var(--border-default)'}`,
      padding: '0 14px', fontSize: 15, fontFamily: 'var(--font-sans)', color: 'var(--text-body)', outline: 'none',
      boxShadow: focus ? 'var(--shadow-focus)' : 'none', transition: 'border var(--duration-fast),box-shadow var(--duration-fast)',
    },
  }), (error || helper) && React.createElement('span', { style: { fontSize: 12, color: error ? 'var(--danger-500)' : 'var(--text-muted)' } }, error || helper));
}

export const components = { Button, Input, Toast };
