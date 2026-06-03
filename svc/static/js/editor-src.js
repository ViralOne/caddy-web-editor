import { basicSetup, EditorView } from 'codemirror';
import { EditorState } from '@codemirror/state';
import { keymap } from '@codemirror/view';
import { oneDark } from '@codemirror/theme-one-dark';
import { StreamLanguage } from '@codemirror/language';

window.CM = { EditorView, EditorState, keymap, oneDark, StreamLanguage, basicSetup };
