import type { ReactNode } from 'react';

/** Plural message: CLDR categories; `other` is the required fallback. */
export type PluralMessage = { readonly other: string } & Partial<
  Record<'zero' | 'one' | 'two' | 'few' | 'many', string>
>;

/** A catalog value: plain/interpolated string, or a plural object. */
export type Message = string | PluralMessage;

/** Interpolation params. The plural-selection count is always named `n`. */
export type Params = Record<string, string | number>;

/**
 * Handlers for rich messages: tag name → node factory. Content tags
 * (`<up>label</up>`) receive the inner label; void tags (`<br/>`) receive ''.
 */
export type RichHandlers = Record<string, (label: string) => ReactNode>;
