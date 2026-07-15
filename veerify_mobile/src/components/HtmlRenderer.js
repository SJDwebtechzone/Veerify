// veerify_mobile/src/components/HtmlRenderer.js
//
// Lightweight HTML-to-React-Native renderer. React Native doesn't have
// a native HTML component, and adding react-native-render-html would
// pull in a heavy dependency for what we need — headings, paragraphs,
// bold / italic / underline, lists, and links. That's what this
// module handles, using a small parser + a walk that produces <Text>
// with the right styles.
//
// The rich-text editor on the admin side produces this exact subset
// of tags (h2, p, ul, ol, li, strong, b, em, i, u, a, br) so the
// output is deterministic. Anything unrecognised is passed through
// as plain text so a stray tag never crashes the render.

import React from 'react';
import { View, Text, Linking } from 'react-native';
import { palette, spacing, type } from '../theme';

// ── Micro HTML parser ────────────────────────────────────────────────
// We roll our own instead of pulling in htmlparser2 because the input
// is a tiny, well-formed subset. Returns a flat array of tokens:
//   { type: 'open',  tag, attrs }
//   { type: 'close', tag }
//   { type: 'text',  text }
function tokenise(html) {
  const tokens = [];
  const re = /<\/?([a-zA-Z][a-zA-Z0-9]*)([^>]*)>|([^<]+)/g;
  let m;
  while ((m = re.exec(html)) !== null) {
    if (m[3] !== undefined) {
      // Text — decode the few HTML entities the editor might produce.
      const text = decodeEntities(m[3]);
      if (text) tokens.push({ type: 'text', text });
      continue;
    }
    const tag = (m[1] || '').toLowerCase();
    const attrs = parseAttrs(m[2] || '');
    const raw = m[0];
    if (raw.startsWith('</')) {
      tokens.push({ type: 'close', tag });
    } else if (raw.endsWith('/>') || tag === 'br') {
      tokens.push({ type: 'open', tag, attrs });
      tokens.push({ type: 'close', tag });
    } else {
      tokens.push({ type: 'open', tag, attrs });
    }
  }
  return tokens;
}

function parseAttrs(raw) {
  const out = {};
  const re = /([a-zA-Z:-]+)\s*=\s*"([^"]*)"|([a-zA-Z:-]+)\s*=\s*'([^']*)'/g;
  let m;
  while ((m = re.exec(raw)) !== null) {
    const name = (m[1] || m[3]).toLowerCase();
    out[name] = m[2] !== undefined ? m[2] : m[4];
  }
  return out;
}

function decodeEntities(s) {
  return s
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

// ── Tree build ───────────────────────────────────────────────────────
// Group the token stream into nested nodes so the renderer can walk
// it recursively. Each node = { tag, attrs, children }; leaves get a
// synthetic { tag: '#text', text }.
function buildTree(html) {
  const tokens = tokenise(html);
  const root = { tag: '#root', children: [] };
  const stack = [root];
  for (const tk of tokens) {
    const top = stack[stack.length - 1];
    if (tk.type === 'text') {
      top.children.push({ tag: '#text', text: tk.text });
    } else if (tk.type === 'open') {
      const node = { tag: tk.tag, attrs: tk.attrs, children: [] };
      top.children.push(node);
      // Self-closing tags don't stack.
      if (!SELF_CLOSING.has(tk.tag)) stack.push(node);
    } else if (tk.type === 'close') {
      // Pop matching open. Ignore stray closes.
      for (let i = stack.length - 1; i > 0; i--) {
        if (stack[i].tag === tk.tag) {
          stack.length = i;
          break;
        }
      }
    }
  }
  return root;
}

const SELF_CLOSING = new Set(['br', 'hr', 'img']);

// ── Renderer ────────────────────────────────────────────────────────
// Walks the tree and emits React Native elements. Text-carrying nodes
// (headings, paragraphs, list items) are wrapped in <View> so their
// margins and inline children compose correctly.

function renderNode(node, ctx, key) {
  if (node.tag === '#text') {
    return (
      <Text key={key} style={inlineStyle(ctx)}>
        {node.text}
      </Text>
    );
  }

  const nextCtx = { ...ctx };
  switch (node.tag) {
    case 'strong':
    case 'b':
      nextCtx.bold = true;
      return renderInline(node, nextCtx, key);
    case 'em':
    case 'i':
      nextCtx.italic = true;
      return renderInline(node, nextCtx, key);
    case 'u':
      nextCtx.underline = true;
      return renderInline(node, nextCtx, key);
    case 'a':
      nextCtx.link = node.attrs?.href || '';
      return renderInline(node, nextCtx, key);
    case 'br':
      return <Text key={key}>{'\n'}</Text>;
    case 'h1':
    case 'h2':
    case 'h3':
      return (
        <View key={key} style={{ marginTop: spacing.md, marginBottom: 4 }}>
          <Text style={{
            ...type.h2, color: palette.text,
            fontSize: node.tag === 'h1' ? 18 : node.tag === 'h2' ? 15 : 14,
            fontWeight: '800',
          }}>
            {renderChildren(node, nextCtx)}
          </Text>
        </View>
      );
    case 'p':
      return (
        <View key={key} style={{ marginVertical: 4 }}>
          <Text style={{ ...type.body, color: palette.text, lineHeight: 22 }}>
            {renderChildren(node, nextCtx)}
          </Text>
        </View>
      );
    case 'ul':
    case 'ol': {
      // Render each <li> child with its own bullet / number.
      const items = (node.children || []).filter((c) => c.tag === 'li');
      return (
        <View key={key} style={{ marginVertical: 4, marginLeft: spacing.sm }}>
          {items.map((li, i) => (
            <View
              key={i}
              style={{ flexDirection: 'row', gap: 6, marginVertical: 2 }}
            >
              <Text style={{ ...type.body, color: palette.text, width: 18 }}>
                {node.tag === 'ol' ? `${i + 1}.` : '•'}
              </Text>
              <Text style={{ ...type.body, color: palette.text, flex: 1, lineHeight: 22 }}>
                {renderChildren(li, nextCtx)}
              </Text>
            </View>
          ))}
        </View>
      );
    }
    case 'div':
      // <div> shows up occasionally when contentEditable normalises
      // pasted content. Treat it as a block wrapper.
      return (
        <View key={key}>{renderChildren(node, nextCtx)}</View>
      );
    default:
      // Unknown tag — render its children inline so the text isn't lost.
      return <Text key={key} style={inlineStyle(nextCtx)}>{renderChildren(node, nextCtx)}</Text>;
  }
}

// Render children of an INLINE node — flatten to a single <Text> that
// can carry mixed bold/italic/underline/link styling.
function renderInline(node, ctx, key) {
  return (
    <Text
      key={key}
      style={inlineStyle(ctx)}
      onPress={ctx.link
        ? () => Linking.openURL(ctx.link).catch(() => {})
        : undefined}
    >
      {renderChildren(node, ctx)}
    </Text>
  );
}

function renderChildren(node, ctx) {
  return (node.children || []).map((child, i) => renderNode(child, ctx, i));
}

function inlineStyle(ctx) {
  return {
    fontWeight: ctx.bold ? '700' : '400',
    fontStyle:  ctx.italic ? 'italic' : 'normal',
    textDecorationLine:
      [
        ctx.underline ? 'underline' : null,
        ctx.link      ? 'underline' : null,
      ].filter(Boolean).join(' ') || 'none',
    color: ctx.link ? palette.purple.vivid : palette.text,
    lineHeight: 22,
  };
}

// Public component. Accepts a raw HTML string produced by the admin
// editor and renders it as a React Native tree. Empty / whitespace-only
// inputs render nothing so the caller can freely conditional-render.
export default function HtmlRenderer({ html }) {
  const clean = String(html || '').trim();
  if (!clean) return null;
  const tree = buildTree(clean);
  return <View>{renderChildren(tree, {})}</View>;
}
