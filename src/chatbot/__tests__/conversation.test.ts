import { describe, expect, test } from 'bun:test';
import { ConversationManager } from '../conversation.js';

describe('ConversationManager', () => {
  test('add and getMessages returns added messages', () => {
    const cm = new ConversationManager();
    cm.add('user', 'hello');
    const msgs = cm.getMessages();
    expect(msgs.length).toBe(1);
    expect(msgs[0].role).toBe('user');
    expect(msgs[0].content).toBe('hello');
  });

  test('multiple messages appear in order', () => {
    const cm = new ConversationManager();
    cm.add('user', 'first');
    cm.add('assistant', 'second');
    cm.add('user', 'third');
    const msgs = cm.getMessages();
    expect(msgs.length).toBe(3);
    expect(msgs[0].content).toBe('first');
    expect(msgs[1].content).toBe('second');
    expect(msgs[2].content).toBe('third');
  });

  test('clear removes all messages', () => {
    const cm = new ConversationManager();
    cm.add('user', 'hello');
    cm.add('assistant', 'world');
    cm.clear();
    expect(cm.getMessages().length).toBe(0);
  });

  test('system messages preserved during trim', () => {
    const cm = new ConversationManager(50);
    cm.add('system', 'You are a helpful assistant.');
    cm.add('user', 'x'.repeat(140));
    cm.add('user', 'y'.repeat(140));
    const msgs = cm.getMessages();
    expect(msgs.length).toBe(2);
    expect(msgs[0].role).toBe('system');
    expect(msgs[0].content).toBe('You are a helpful assistant.');
    expect(msgs[1].role).toBe('user');
    expect(msgs[1].content).toBe('y'.repeat(140));
  });

  test('trim removes oldest non-system messages', () => {
    const cm = new ConversationManager(50);
    cm.add('system', 'sys');
    cm.add('user', 'a'.repeat(28));
    cm.add('user', 'b'.repeat(28));
    cm.add('user', 'c'.repeat(140));
    const msgs = cm.getMessages();
    expect(msgs.length).toBe(2);
    expect(msgs[0].role).toBe('system');
    expect(msgs[0].content).toBe('sys');
    expect(msgs[1].role).toBe('user');
    expect(msgs[1].content).toBe('c'.repeat(140));
  });

  test('empty string content stored correctly', () => {
    const cm = new ConversationManager();
    cm.add('user', '');
    const msgs = cm.getMessages();
    expect(msgs.length).toBe(1);
    expect(msgs[0].content).toBe('');
  });

  test('message order preserved for user/assistant interleaving', () => {
    const cm = new ConversationManager();
    cm.add('user', 'first');
    cm.add('assistant', 'reply');
    cm.add('user', 'follow-up');
    const msgs = cm.getMessages();
    expect(msgs[0].role).toBe('user');
    expect(msgs[0].content).toBe('first');
    expect(msgs[1].role).toBe('assistant');
    expect(msgs[1].content).toBe('reply');
    expect(msgs[2].role).toBe('user');
    expect(msgs[2].content).toBe('follow-up');
  });

  test('token estimation triggers trim on overflow', () => {
    const cm = new ConversationManager(50);
    cm.add('user', 'hello');
    cm.add('user', 'hello');
    cm.add('user', 'x'.repeat(140));
    const msgs = cm.getMessages();
    expect(msgs.length).toBeLessThanOrEqual(2);
  });
});
