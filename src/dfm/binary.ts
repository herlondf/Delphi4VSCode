/**
 * Decodifica o .dfm binário (assinatura TPF0) para o mesmo texto que o Delphi grava.
 *
 * O formato é um fluxo de objetos: prefixo opcional, classe, nome, propriedades tipadas e
 * filhos, cada nível terminado por um byte zero. Só leitura — a edição continua em texto.
 *
 * Dois detalhes que não estão em lugar nenhum óbvio e que quebram o parser em silêncio:
 *  - a enum TValueType tem 22 valores; `vaLString`, `vaNil` e `vaCollection` ocupam 12, 13 e 14,
 *    e um mapa deslocado a partir daí desalinha o fluxo inteiro;
 *  - com a flag `ffChildPos`, a posição do filho vem ANTES do nome da classe, não depois.
 */

/** TValueType do System.Classes, na ordem em que o Delphi grava. */
const enum VT {
  Null = 0, List, Int8, Int16, Int32, Extended, String, Ident, False, True,
  Binary, Set, LString, Nil, Collection, Single, Currency, Date, WString, Int64,
  UTF8String, Double,
}

export function isBinaryDfm(data: Uint8Array): boolean {
  return findSignature(data) >= 0;
}

/** O convert.exe embrulha o form como recurso: 0xFF, nome, tamanho e só então `TPF0`. */
function findSignature(data: Uint8Array): number {
  const limit = Math.min(data.length - 4, 128);
  for (let i = 0; i <= limit; i++) {
    if (data[i] === 0x54 && data[i + 1] === 0x50 && data[i + 2] === 0x46 && data[i + 3] === 0x30) {
      return i;
    }
  }
  return -1;
}

export function decodeBinaryDfm(data: Uint8Array): string {
  const at = findSignature(data);
  if (at < 0) { throw new Error('assinatura TPF0 não encontrada'); }
  return new BinReader(data, at + 4).run();
}

class BinReader {
  private out: string[] = [];

  constructor(private d: Uint8Array, private i: number) {}

  run(): string {
    this.obj(0);
    return this.out.join('\n') + '\n';
  }

  private byte(): number {
    if (this.i >= this.d.length) { throw new Error('fluxo terminou no meio de um valor'); }
    return this.d[this.i++];
  }

  private int(n: number, signed = false): number {
    let v = 0;
    for (let k = 0; k < n; k++) { v += this.d[this.i + k] * 2 ** (8 * k); }
    this.i += n;
    if (signed) {
      const limit = 2 ** (8 * n - 1);
      if (v >= limit) { v -= limit * 2; }
    }
    return v;
  }

  /** String curta: 1 byte de tamanho. É como classe, nome e propriedade são gravados. */
  private pstr(): string {
    const n = this.byte();
    const s = latin1(this.d.subarray(this.i, this.i + n));
    this.i += n;
    return s;
  }

  private value(): string {
    const t = this.byte();
    switch (t) {
      case VT.Null: return '';
      case VT.List: {
        const items: string[] = [];
        while (this.d[this.i] !== 0) { items.push(this.value()); }
        this.i++;
        return '(\n    ' + items.join('\n    ') + ')';
      }
      case VT.Int8: return String(this.int(1, true));
      case VT.Int16: return String(this.int(2, true));
      case VT.Int32: return String(this.int(4, true));
      case VT.Extended: this.i += 10; return '0';
      case VT.String: return quote(this.pstr());
      case VT.Ident: return this.pstr();
      case VT.False: return 'False';
      case VT.True: return 'True';
      case VT.Binary: {
        const n = this.int(4);
        const hex = toHex(this.d.subarray(this.i, this.i + n));
        this.i += n;
        return `{\n    ${hex}}`;
      }
      case VT.Set: {
        const items: string[] = [];
        for (;;) {
          const s = this.pstr();
          if (!s) { break; }
          items.push(s);
        }
        return `[${items.join(', ')}]`;
      }
      case VT.LString: {
        const n = this.int(4);
        const s = latin1(this.d.subarray(this.i, this.i + n));
        this.i += n;
        return quote(s);
      }
      case VT.Nil: return 'nil';
      case VT.Collection: {
        const items: string[] = [];
        while (this.d[this.i] !== 0) {
          // índice opcional do item, e então o marcador de lista que o abre
          if (this.d[this.i] >= VT.Int8 && this.d[this.i] <= VT.Int32) { this.value(); }
          if (this.d[this.i] === VT.List) { this.i++; }
          const body: string[] = [];
          while (this.d[this.i] !== 0) { body.push(`      ${this.pstr()} = ${this.value()}`); }
          this.i++;
          items.push('    item\n' + body.join('\n') + '\n    end');
        }
        this.i++;
        return '<\n' + items.join('\n') + '>';
      }
      case VT.Single: this.i += 4; return '0';
      case VT.Currency: case VT.Date: case VT.Double: this.i += 8; return '0';
      case VT.WString: {
        const n = this.int(4);
        const s = utf16(this.d.subarray(this.i, this.i + n * 2));
        this.i += n * 2;
        return quote(s);
      }
      case VT.Int64: return String(this.int(8, true));
      case VT.UTF8String: {
        const n = this.int(4);
        const s = new TextDecoder('utf-8').decode(this.d.subarray(this.i, this.i + n));
        this.i += n;
        return quote(s);
      }
      default:
        throw new Error(`tipo de valor desconhecido no .dfm binário: ${t}`);
    }
  }

  private obj(depth: number): void {
    const pad = '  '.repeat(depth);
    let flags = 0;
    if ((this.d[this.i] & 0xf0) === 0xf0) { flags = this.byte() & 0x0f; }
    // ffChildPos: a posição vem antes da classe. Ler depois desalinha tudo daqui pra frente.
    if (flags & 2) { this.value(); }
    const cls = this.pstr();
    const name = this.pstr();
    const prefix = flags & 1 ? 'inherited' : flags & 4 ? 'inline' : 'object';
    this.out.push(name ? `${pad}${prefix} ${name}: ${cls}` : `${pad}${prefix} ${cls}`);

    while (this.d[this.i] !== 0) { this.out.push(`${pad}  ${this.pstr()} = ${this.value()}`); }
    this.i++;
    while (this.d[this.i] !== 0) { this.obj(depth + 1); }
    this.i++;
    this.out.push(`${pad}end`);
  }
}

function quote(s: string): string {
  return `'${s.replace(/'/g, "''")}'`;
}

function latin1(bytes: Uint8Array): string {
  let s = '';
  for (const b of bytes) { s += String.fromCharCode(b); }
  return s;
}

function utf16(bytes: Uint8Array): string {
  let s = '';
  for (let i = 0; i + 1 < bytes.length; i += 2) {
    s += String.fromCharCode(bytes[i] | (bytes[i + 1] << 8));
  }
  return s;
}

function toHex(bytes: Uint8Array): string {
  let s = '';
  for (const b of bytes) { s += b.toString(16).padStart(2, '0').toUpperCase(); }
  return s;
}
