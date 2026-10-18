import { entropicTheme, createComponent } from '@sentropic/design-system-themes';

const semantic = {
  ...entropicTheme.tokens.semantic,
  surface: { default: '#0f172a', subtle: '#172033', raised: '#1e293b', inverse: '#f8fafc', overlay: 'rgb(0 0 0 / 0.5)' },
  text: { primary: '#f1f5f9', secondary: '#cbd5e1', muted: '#94a3b8', inverse: '#0f172a', link: '#93c5fd' },
  border: { subtle: '#475569', strong: '#94a3b8', interactive: '#93c5fd' },
  action: { ...entropicTheme.tokens.semantic.action, primary: '#2563eb', primaryHover: '#1d4ed8',
    secondary: '#1e293b', secondaryHover: '#334155', secondaryText: '#f1f5f9' },
};
export const lightTheme = entropicTheme;
export const darkTheme = {
  ...entropicTheme, id: 'entropic-dark', label: 'Entropic sombre', mode: 'dark',
  tokens: { ...entropicTheme.tokens, semantic, component: createComponent(semantic, entropicTheme.tokens.foundation) },
};
