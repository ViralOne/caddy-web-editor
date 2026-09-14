import { basicSetup, EditorView } from 'codemirror';
import { EditorState, StateEffect, StateField, RangeSetBuilder } from '@codemirror/state';
import { keymap, Decoration } from '@codemirror/view';
import { oneDark } from '@codemirror/theme-one-dark';
import { StreamLanguage } from '@codemirror/language';
import { indentWithTab } from '@codemirror/commands';

window.CM = {
  EditorView, EditorState, keymap, oneDark, StreamLanguage, basicSetup, indentWithTab,
  // Used by the find bar to highlight matches and the current row.
  Decoration, StateEffect, StateField, RangeSetBuilder,
};
