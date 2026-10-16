// Renders the AST produced by tools/build-studio.mjs with React, reproducing the design runtime
// (dc-runtime) semantics the templates rely on: plain-path bindings, sc-if / sc-for, x-import wrappers
// (div.sc-host-x), text interpolations wrapped in span.sc-interp, the whitespace rule for static text,
// and a logic host whose setState patches state synchronously before re-rendering.
//
// One deliberate difference: style strings are split on ";" only outside quotes and parentheses. The
// runtime splits on every ";", which breaks url("data:image/...;base64,...") and so breaks uploaded
// photos and logos, which the logic stores as data URLs.
import React from 'react';

const h = React.createElement;
const IDENT_RE = /^[A-Za-z_$][A-Za-z0-9_$]*/;
const NUMBER_RE = /^-?\d+(\.\d+)?$/;

function resolvePath(vals, expr) {
  const head = expr.match(IDENT_RE);
  if (!head) return undefined;
  let cur = vals == null ? undefined : vals[head[0]];
  let i = head[0].length;
  while (i < expr.length) {
    if (expr[i] === '.') {
      const m = expr.slice(i + 1).match(IDENT_RE) || expr.slice(i + 1).match(/^\d+/);
      if (!m) return undefined;
      cur = cur == null ? undefined : cur[m[0]];
      i += 1 + m[0].length;
    } else if (expr[i] === '[') {
      let depth = 1;
      let j = i + 1;
      while (j < expr.length && depth > 0) {
        if (expr[j] === '[') depth++;
        else if (expr[j] === ']') { depth--; if (depth === 0) break; }
        j++;
      }
      if (depth !== 0) return undefined;
      const key = resolve(vals, expr.slice(i + 1, j));
      cur = cur == null ? undefined : cur[key];
      i = j + 1;
    } else return undefined;
  }
  return cur;
}

/** Literals, "!" and plain paths: everything these templates use. */
export function resolve(vals, src) {
  const expr = String(src).trim();
  if (!expr) return undefined;
  if (expr[0] === '!') return !resolve(vals, expr.slice(1));
  if (expr === 'true') return true;
  if (expr === 'false') return false;
  if (expr === 'null') return null;
  if (expr === 'undefined') return undefined;
  if (NUMBER_RE.test(expr)) return Number(expr);
  if (expr.length >= 2 && (expr[0] === '"' || expr[0] === "'") && expr[expr.length - 1] === expr[0]) return expr.slice(1, -1);
  return resolvePath(vals, expr);
}

function evalSpec(spec, vals) {
  if (typeof spec === 'string') return spec;
  if ('b' in spec) return resolve(vals, spec.b);
  return spec.p.map((s, i) => (i & 1 ? resolve(vals, s) ?? '' : s)).join('');
}

const kebabToCamel = (s) => s.replace(/-([a-z])/g, (_, c) => c.toUpperCase());

/** "a:b;c:url(x;y)" -> { a: 'b', c: 'url(x;y)' }, splitting only on top-level semicolons. */
export function cssToObj(css) {
  const o = {};
  let start = 0, depth = 0, quote = '';
  const take = (decl) => {
    const i = decl.indexOf(':');
    if (i < 0) return;
    const prop = decl.slice(0, i).trim();
    o[prop.startsWith('--') ? prop : kebabToCamel(prop)] = decl.slice(i + 1).trim();
  };
  for (let i = 0; i < css.length; i++) {
    const c = css[i];
    if (quote) { if (c === '\\') i++; else if (c === quote) quote = ''; }
    else if (c === '"' || c === "'") quote = c;
    else if (c === '(') depth++;
    else if (c === ')') depth = Math.max(0, depth - 1);
    else if (c === ';' && depth === 0) { take(css.slice(start, i)); start = i + 1; }
  }
  take(css.slice(start));
  return o;
}

const HOST_STYLE_PROPS = new Set(['position', 'left', 'right', 'top', 'bottom', 'inset', 'width', 'height', 'z-index', 'transform']);
function hostPositionStyle(style) {
  const all = typeof style === 'string' ? cssToObj(style) : null;
  if (!all) return undefined;
  const out = {};
  for (const [k, v] of Object.entries(all)) {
    const kebab = k.replace(/[A-Z]/g, (c) => '-' + c.toLowerCase());
    if (HOST_STYLE_PROPS.has(kebab)) out[k] = v;
  }
  return Object.keys(out).length ? out : undefined;
}

function interp(v, key) {
  if (v === undefined || v === null || typeof v === 'boolean') return null;
  if (React.isValidElement(v) || Array.isArray(v)) return h(React.Fragment, { key }, v);
  return h('span', { key, className: 'sc-interp' }, String(v));
}

function renderNode(node, vals, components, key) {
  switch (node[0]) {
    case 't':
      return node[1];
    case 'T':
      return h(React.Fragment, { key }, ...node[1].map((p, i) => (i & 1 ? interp(resolve(vals, p), i) : p)));
    case 'if':
      return evalSpec(node[1], vals) ? h(React.Fragment, { key }, ...renderNodes(node[2], vals, components)) : null;
    case 'for': {
      const list = evalSpec(node[1], vals);
      if (!Array.isArray(list)) return null;
      return h(React.Fragment, { key }, list.map((item, i) =>
        h(React.Fragment, { key: i }, ...renderNodes(node[3], { ...vals, [node[2]]: item, $index: i }, components))));
    }
    case 'x': {
      const [, name, styleSpec, propSpecs, kids] = node;
      const C = components[name];
      if (!C) throw new Error(`unknown design-system component ${name}`);
      const props = {};
      for (const [k, s] of propSpecs) props[k] = evalSpec(s, vals);
      if (kids.length) props.children = renderNodes(kids, vals, components);
      const hostStyle = styleSpec != null ? hostPositionStyle(evalSpec(styleSpec, vals)) : undefined;
      return h('div', { key, className: 'sc-host-x', style: hostStyle || { display: 'contents' } }, h(C, props));
    }
    case 'e': {
      const [, tag, propSpecs, kids, hover] = node;
      const props = { key };
      for (const [k, s] of propSpecs) {
        let v = evalSpec(s, vals);
        if (k === 'style' && typeof v === 'string') v = cssToObj(v);
        if ((k === 'value' || k === 'checked') && v === undefined) v = k === 'checked' ? false : '';
        props[k] = v;
      }
      if (hover) props.className = [props.className, hover].filter(Boolean).join(' ');
      return h(tag, props, ...renderNodes(kids, vals, components));
    }
    default:
      return null;
  }
}

export function renderNodes(nodes, vals, components) {
  return nodes.map((n, i) => renderNode(n, vals, components, i));
}

/** The base class the design's logic extends ("DCLogic" in the design). */
export class StreamableLogic {
  constructor(props) {
    this.props = props || {};
    this.state = {};
    this.__host = undefined;
  }
  setState(update, cb) { if (this.__host) this.__host.__setLogicState(update, cb); }
  forceUpdate() { if (this.__host) this.__host.forceUpdate(); }
  componentDidMount() {}
  componentDidUpdate() {}
  componentWillUnmount() {}
  renderVals() { return {}; }
}

/**
 * Hosts one logic instance and renders its template. State updates patch logic.state synchronously,
 * as in the design runtime, then re-render. componentDidUpdate receives (prevProps, prevState); the
 * runtime passed only prevProps, which left the mobile design's share pre-render switched off.
 */
export class Host extends React.Component {
  constructor(props) {
    super(props);
    this.state = { v: 0 };
    this.logic = new props.Logic(props.userProps);
    this.logic.__host = this;
    if (props.initialState) this.logic.state = { ...this.logic.state, ...props.initialState };
    this.prevLogicState = null;
    // Test hook for tools/stress-cards.mjs. Only card data built by the test tools sets `debug`; the server never does.
    if (props.userProps && props.userProps.card && props.userProps.card.debug === true) window.__dcHost = this;
  }
  __setLogicState(update, cb) {
    const prev = this.logic.state;
    const patch = typeof update === 'function' ? update(prev) : update;
    this.logic.state = { ...prev, ...patch };
    if (!this.prevLogicState) this.prevLogicState = prev;
    this.setState((s) => ({ v: s.v + 1 }), cb);
  }
  componentDidMount() { this.logic.componentDidMount(); }
  componentDidUpdate(prevProps) {
    const ps = this.prevLogicState;
    this.prevLogicState = null;
    this.logic.props = this.props.userProps;
    this.logic.componentDidUpdate(prevProps.userProps, ps || undefined);
  }
  componentWillUnmount() {
    if (this.props.onUnmount) this.props.onUnmount(this.logic.state);
    this.logic.componentWillUnmount();
  }
  render() {
    const vals = { ...this.props.userProps, ...this.logic.renderVals() };
    return h('div', { className: 'sc-host' }, ...renderNodes(this.props.ast, vals, this.props.components));
  }
}
