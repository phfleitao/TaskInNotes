import { expect, it } from 'vitest';
import { loadSettings } from '../src/settings';
it('keeps only a non-secret reference and a supported duplicate policy', () => {
  expect(loadSettings({ secretId: 'todoist-private', duplicateIdPolicy: 'regenerate', token: 'must-not-persist', showSuccessFeedback: true })).toEqual({ secretId: 'todoist-private', duplicateIdPolicy: 'regenerate', showSuccessFeedback: true, debugEnabled: false, logDirectory: '' });
  expect(loadSettings({ secretId: { token: 'bad' }, duplicateIdPolicy: 'invalid' })).toEqual({ secretId: '', duplicateIdPolicy: 'ask', showSuccessFeedback: false, debugEnabled: false, logDirectory: '' });
});
