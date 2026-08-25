

import { AppError } from '../contracts/errors.js';

const ALLOWED_PROTOCOLS = new Set(['http:', 'https:']);

const INTERNAL_SUFFIXES = ['.local', '.internal', '.home.arpa', '.localdomain'];

function isInternalName(hostname: string): boolean {
  return (
    hostname === 'localhost' ||
    hostname.endsWith('.localhost') ||
    INTERNAL_SUFFIXES.some((suffix) => hostname.endsWith(suffix))
  );
}

function parseIpv4(hostname: string): number[] | null {
  const parts = hostname.split('.');
  if (parts.length !== 4) {
    return null;
  }

  const octets: number[] = [];
  for (const part of parts) {
    if (!/^\d{1,3}$/u.test(part)) {
      return null;
    }
    const value = Number(part);
    if (value > 255) {
      return null;
    }
    octets.push(value);
  }

  return octets;
}

function isPrivateIpv4(octets: readonly number[]): boolean {
  const [a = 0, b = 0] = octets;

  return (
    a === 0 || 
    a === 10 || 
    a === 127 || 
    (a === 100 && b >= 64 && b <= 127) || 
    (a === 169 && b === 254) || 
    (a === 172 && b >= 16 && b <= 31) || 
    (a === 192 && b === 168) || 
    (a === 198 && (b === 18 || b === 19)) || 
    a >= 224 
  );
}

function isPrivateIpv6(hostname: string): boolean {
  const address = hostname.replace(/^\[|\]$/gu, '').toLowerCase();

  if (address === '::1' || address === '::') {
    return true;
  }

  
  if (/^f[cd][0-9a-f]{2}:/u.test(address) || /^fe[89ab][0-9a-f]:/u.test(address)) {
    return true;
  }

  
  const dotted = /::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/u.exec(address);
  if (dotted?.[1] !== undefined) {
    const octets = parseIpv4(dotted[1]);
    return octets !== null && isPrivateIpv4(octets);
  }

  
  
  
  const hex = /::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/u.exec(address);
  if (hex?.[1] !== undefined && hex[2] !== undefined) {
    const high = Number.parseInt(hex[1], 16);
    const low = Number.parseInt(hex[2], 16);
    return isPrivateIpv4([high >> 8, high & 0xff, low >> 8, low & 0xff]);
  }

  return false;
}

export interface LinkCheck {
  readonly ok: boolean;
  
  readonly reason: string | null;
  
  readonly url: string | null;
}

export function checkExternalUrl(raw: string): LinkCheck {
  const trimmed = raw.trim();

  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    return { ok: false, reason: 'это не похоже на адрес', url: null };
  }

  if (!ALLOWED_PROTOCOLS.has(parsed.protocol)) {
    return { ok: false, reason: 'разрешены только ссылки http и https', url: null };
  }

  
  
  if (parsed.username !== '' || parsed.password !== '') {
    return { ok: false, reason: 'в адресе не должно быть логина и пароля', url: null };
  }

  const hostname = parsed.hostname.toLowerCase();

  if (hostname === '') {
    return { ok: false, reason: 'в адресе нет узла', url: null };
  }

  if (isInternalName(hostname)) {
    return { ok: false, reason: 'адрес ведёт во внутреннюю сеть', url: null };
  }

  const octets = parseIpv4(hostname);
  if (octets !== null && isPrivateIpv4(octets)) {
    return { ok: false, reason: 'адрес ведёт во внутреннюю сеть', url: null };
  }

  if (hostname.startsWith('[') && isPrivateIpv6(hostname)) {
    return { ok: false, reason: 'адрес ведёт во внутреннюю сеть', url: null };
  }

  return { ok: true, reason: null, url: parsed.toString() };
}

export function requireExternalUrl(raw: string): string {
  const checked = checkExternalUrl(raw);

  if (!checked.ok || checked.url === null) {
    throw new AppError('VALIDATION_FAILED', {
      message: `Ссылка отклонена: ${checked.reason ?? 'неизвестная причина'}`,
    });
  }

  return checked.url;
}
