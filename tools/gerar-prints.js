/*
 * Gera as imagens do README a partir do render de verdade.
 *
 * Não é mockup: o HTML sai do mesmo `renderForm` que a webview usa, com o mesmo CSS. O que
 * falta na imagem é só a moldura do VS Code — barra de abas, barra lateral —, que não dá para
 * capturar de fora do editor.
 *
 * O form é o `samples/designer/CadastroDemo.dfm`, feito para isto e só com componentes da VCL:
 * um form de projeto de terceiro não entra num README público, e um que dependesse de
 * componente comercial não renderizaria na máquina de quem clonar.
 *
 *   node tools/gerar-prints.js
 */
const cp = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const RAIZ = path.resolve(__dirname, '..');
const OUT = path.join(RAIZ, 'out');
const { Registry } = require(path.join(OUT, 'dfm/registry'));
const { DfmDocument } = require(path.join(OUT, 'dfm/document'));
const { renderForm } = require(path.join(OUT, 'dfm/render'));
const { descobrirFontes } = require(path.join(OUT, 'dfm/sources'));

const EDGE = [
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
].find(p => fs.existsSync(p));

/** O HTML da webview vem com `link` e `script` por URI; aqui tudo vira embutido. */
function autoContido(html) {
  const css = fs.readFileSync(path.join(RAIZ, 'media/webview.css'), 'utf8');
  return html
    .replace(/<link rel="stylesheet"[^>]*>/g, `<style>${css}</style>`)
    .replace(/<script[^>]*>[\s\S]*?<\/script>/g, '')
    .replace(/<meta http-equiv="Content-Security-Policy"[^>]*>/g, '')
    .replace(/\$\{cspSource\}/g, '')
    /*
     * O painel lateral sai da imagem.
     *
     * Estrutura e Propriedades são preenchidos pelo script, e sem ele ficariam dois títulos
     * sobre um retângulo vazio — o que passaria a impressão errada de painel que não funciona.
     * A captura mostra o que é estático: o form desenhado.
     */
    .replace(/<div id="side">[\s\S]*?<div id="oi">[\s\S]*?<\/div><\/div>/, '')
    .replace(/ class="has-side"/g, '');
}

function capturar(html, destino, largura, altura) {
  const tmp = path.join(os.tmpdir(), `d4v-print-${Date.now().toString(36)}.html`);
  fs.writeFileSync(tmp, html, 'utf8');
  const args = [
    '--headless=new', '--disable-gpu', '--hide-scrollbars',
    `--window-size=${largura},${altura}`,
    `--screenshot=${destino}`,
    `--virtual-time-budget=2000`,
    `file:///${tmp.replace(/\\/g, '/')}`,
  ];
  const r = cp.spawnSync(EDGE, args, { encoding: 'utf8', timeout: 120000 });
  fs.rmSync(tmp, { force: true });
  if (!fs.existsSync(destino)) {
    throw new Error(`não gerou ${destino}: ${r.stderr || r.stdout || 'sem saída'}`);
  }
  return fs.statSync(destino).size;
}

function main() {
  if (!EDGE) { throw new Error('não achei Edge nem Chrome para capturar'); }
  const reg = new Registry();
  reg.scan(descobrirFontes({ versaoBds: '21.0', workspace: [RAIZ] }).fontes.map(f => f.dir),
    120000);
  if (reg.size === 0) { throw new Error('índice vazio: sem VCL indexada não há o que desenhar'); }

  const destinoDir = path.join(RAIZ, 'docs/img');
  fs.mkdirSync(destinoDir, { recursive: true });

  const alvo = path.join(RAIZ, 'samples/designer/CadastroDemo.dfm');
  const doc = DfmDocument.fromFile(alvo, reg);
  const { html, stats } = renderForm(doc, reg, { flexLayout: false, canWrite: true });
  console.log(`${path.basename(alvo)}: ${stats.visuais} componentes visuais, ` +
    `${stats.editaveis} editáveis`);

  const destino = path.join(destinoDir, 'designer.png');
  const bytes = capturar(autoContido(html), destino, 720, 560);
  console.log(`docs/img/designer.png — ${(bytes / 1024).toFixed(0)} KB`);
}

main();
