import { describe, expect, it } from 'vitest';
import { chooseShell } from './shell';

const desktop = { search: '', stored: null, finePointer: true, width: 1440 };
const phone = { search: '', stored: null, finePointer: false, width: 390 };

describe('chooseShell (spec §20.3)', () => {
  it('serves the phone to everyone until the desk is ready', () => {
    expect(chooseShell(desktop, false)).toBe('phone');
    expect(chooseShell({ ...desktop, stored: 'desk' }, false)).toBe('phone');
  });

  it('lets ?desk and ?phone override everything', () => {
    expect(chooseShell({ ...phone, search: '?desk' }, false)).toBe('desk');
    expect(chooseShell({ ...desktop, search: '?phone' }, true)).toBe('phone');
  });

  it('picks the desk for a fine pointer on a wide screen, once ready', () => {
    expect(chooseShell(desktop, true)).toBe('desk');
    expect(chooseShell(phone, true)).toBe('phone');
    expect(chooseShell({ ...desktop, width: 1000 }, true)).toBe('phone');
    expect(chooseShell({ ...desktop, finePointer: false }, true)).toBe('phone');
  });

  it('honours a remembered choice over detection', () => {
    expect(chooseShell({ ...desktop, stored: 'phone' }, true)).toBe('phone');
    expect(chooseShell({ ...phone, stored: 'desk' }, true)).toBe('desk');
    expect(chooseShell({ ...phone, stored: 'nonsense' }, true)).toBe('phone');
  });
});
