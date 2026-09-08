/*
 * Gera o ícone da extensão (128x128 PNG) sem depender de nenhuma biblioteca de imagem.
 *
 * O VS Code exige PNG para o ícone da galeria, e um arquivo binário no repositório sem o
 * código que o produziu é um arquivo que ninguém consegue ajustar depois. Daí o gerador ficar
 * versionado junto: `node tools/gerar-icone.js` reescreve `media/icon.png`.
 *
 * O desenho: um "form" sobre fundo escuro — barra de título, um campo e um botão. É o que a
 * extensão faz de mais visível, e lê bem nos 32px que a lista de extensões realmente mostra.
 */
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const LADO = 128;

/* Paleta: azul-ardósia escuro, com o vermelho da Embarcadero como acento. */
const FUNDO = [21, 26, 34];
const MOLDURA = [63, 78, 96];
const PAPEL = [238, 241, 245];
const BARRA = [58, 90, 140];
const ACENTO = [200, 62, 54];
const CAMPO = [186, 196, 208];

const px = Buffer.alloc(LADO * LADO * 4);

function por(x, y, cor, alfa = 255) {
  if (x < 0 || y < 0 || x >= LADO || y >= LADO) { return; }
  const i = (y * LADO + x) * 4;
  const a = alfa / 255;
  px[i] = Math.round(px[i] * (1 - a) + cor[0] * a);
  px[i + 1] = Math.round(px[i + 1] * (1 - a) + cor[1] * a);
  px[i + 2] = Math.round(px[i + 2] * (1 - a) + cor[2] * a);
  px[i + 3] = 255;
}

/** Retângulo com cantos arredondados, com uma borda suavizada de 1px. */
function retangulo(x0, y0, largura, altura, raio, cor) {
  for (let y = y0; y < y0 + altura; y++) {
    for (let x = x0; x < x0 + largura; x++) {
      const dx = Math.max(x0 + raio - x, x - (x0 + largura - 1 - raio), 0);
      const dy = Math.max(y0 + raio - y, y - (y0 + altura - 1 - raio), 0);
      const d = Math.hypot(dx, dy);
      if (d <= raio - 0.5) { por(x, y, cor); }
      else if (d < raio + 0.5) { por(x, y, cor, Math.round((raio + 0.5 - d) * 255)); }
    }
  }
}

// fundo
retangulo(0, 0, LADO, LADO, 22, FUNDO);
// o form: moldura, papel e barra de título
retangulo(20, 24, 88, 80, 7, MOLDURA);
retangulo(22, 26, 84, 76, 6, PAPEL);
retangulo(22, 26, 84, 16, 6, BARRA);
retangulo(22, 36, 84, 6, 0, BARRA);
// três "botões" da barra de título
for (let i = 0; i < 3; i++) { retangulo(84 + i * 7, 32, 4, 4, 2, PAPEL); }
// dois campos e um botão, que é o que um form de cadastro tem
retangulo(30, 52, 68, 8, 3, CAMPO);
retangulo(30, 66, 68, 8, 3, CAMPO);
retangulo(70, 82, 28, 12, 4, ACENTO);

/* ---- PNG ---- */
function pedaco(tipo, dados) {
  const tam = Buffer.alloc(4);
  tam.writeUInt32BE(dados.length);
  const corpo = Buffer.concat([Buffer.from(tipo, 'latin1'), dados]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(corpo) >>> 0);
  return Buffer.concat([tam, corpo, crc]);
}

const TABELA = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) { c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; }
    t[n] = c;
  }
  return t;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (const b of buf) { c = TABELA[(c ^ b) & 0xff] ^ (c >>> 8); }
  return c ^ 0xffffffff;
}

// cada linha do PNG leva um byte de filtro na frente; 0 = sem filtro
const bruto = Buffer.alloc((LADO * 4 + 1) * LADO);
for (let y = 0; y < LADO; y++) {
  bruto[y * (LADO * 4 + 1)] = 0;
  px.copy(bruto, y * (LADO * 4 + 1) + 1, y * LADO * 4, (y + 1) * LADO * 4);
}

const ihdr = Buffer.alloc(13);
ihdr.writeUInt32BE(LADO, 0);
ihdr.writeUInt32BE(LADO, 4);
ihdr[8] = 8;    // 8 bits por canal
ihdr[9] = 6;    // RGBA
const png = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  pedaco('IHDR', ihdr),
  pedaco('IDAT', zlib.deflateSync(bruto, { level: 9 })),
  pedaco('IEND', Buffer.alloc(0)),
]);

const destino = path.join(__dirname, '..', 'media', 'icon.png');
fs.writeFileSync(destino, png);
console.log(`${destino} — ${LADO}x${LADO}, ${png.length} bytes`);
