import { basicSetup, EditorView } from 'codemirror';
import { EditorState } from '@codemirror/state';
import { keymap } from '@codemirror/view';
import { oneDark } from '@codemirror/theme-one-dark';
import { StreamLanguage } from '@codemirror/language';
import { indentWithTab } from '@codemirror/commands';

window.CM = { EditorView, EditorState, keymap, oneDark, StreamLanguage, basicSetup, indentWithTab };
