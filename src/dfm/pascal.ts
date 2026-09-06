/**
 * Leitura leve de uma unit Object Pascal.
 *
 * Não é um compilador: extrai o suficiente para cruzar o `.pas` com o `.dfm` irmão, que é
 * onde mora uma classe de erro cara — o form compila, e quebra ao abrir em runtime, porque
 * o componente do `.dfm` não tem campo na classe ou o handler não existe.
 */

export interface PasField {
  nome: string;
  tipo: string;
  linha: number;
}

export interface PasMethod {
  nome: string;
  linha: number;
  /** Declarado na classe (interface) ou implementado (`procedure TForm1.X`). */
  implementado: boolean;
}

export interface PasUnit {
  nome: string;
  linhaUnit: number;
  /** Classe do form: a primeira que descende de algo com `Form`, `Frame` ou `DataModule`. */
  classe?: string;
  linhaClasse: number;
  ancestral?: string;
  /** Campos da seção published — é lá que os componentes do .dfm são declarados. */
  campos: PasField[];
  metodos: PasMethod[];
  uses: { nome: string; linha: number }[];
}

const RE_UNIT = /^\s*unit\s+([\w.]+)/i;
const RE_CLASSE = /^\s*(T\w+)\s*=\s*class\s*\(\s*(T\w+)/i;
const RE_CAMPO = /^\s*([A-Za-z_]\w*)\s*:\s*([A-Za-z_][\w.]*)\s*;/;
const RE_DECL = /^\s*(?:procedure|function)\s+([A-Za-z_]\w*)\s*[(;:]/i;
const RE_IMPL = /^\s*(?:procedure|function)\s+([A-Za-z_]\w*)\.([A-Za-z_]\w*)/i;
const RE_SECAO = /^\s*(private|protected|public|published|strict\s+private|strict\s+protected)\b/i;
const RE_FIM_CLASSE = /^\s*end\s*;/;

export function parsePascal(texto: string): PasUnit {
  const linhas = texto.split(/\r?\n/);
  const out: PasUnit = {
    nome: '', linhaUnit: 0, linhaClasse: 0,
    campos: [], metodos: [], uses: [],
  };

  let secao = '';
  let dentroClasse = false;
  let emUses = false;
  let emComentario = false;

  for (let i = 0; i < linhas.length; i++) {
    const bruta = linhas[i];
    // tira comentários para não confundir declaração com texto
    let l = bruta;
    if (emComentario) {
      const fim = l.indexOf('}');
      if (fim < 0) { continue; }
      l = l.slice(fim + 1);
      emComentario = false;
    }
    l = l.replace(/\/\/.*$/, '');
    const abre = l.indexOf('{');
    if (abre >= 0 && !/\{\$/.test(l.slice(abre))) {
      const fecha = l.indexOf('}', abre);
      if (fecha < 0) { emComentario = true; l = l.slice(0, abre); }
      else { l = l.slice(0, abre) + l.slice(fecha + 1); }
    }
    if (!l.trim()) { continue; }

    if (!out.nome) {
      const m = RE_UNIT.exec(l);
      if (m) { out.nome = m[1]; out.linhaUnit = i; continue; }
    }

    if (/^\s*uses\b/i.test(l)) { emUses = true; }
    if (emUses) {
      for (const m of l.matchAll(/([A-Za-z_][\w.]*)/g)) {
        const nome = m[1];
        if (/^(uses|in)$/i.test(nome)) { continue; }
        out.uses.push({ nome, linha: i });
      }
      if (l.includes(';')) { emUses = false; }
      continue;
    }

    const mc = RE_CLASSE.exec(l);
    if (mc && !out.classe) {
      out.classe = mc[1];
      out.ancestral = mc[2];
      out.linhaClasse = i;
      dentroClasse = true;
      secao = 'published';   // antes da primeira seção, o padrão do Delphi é published
      continue;
    }

    if (dentroClasse) {
      const ms = RE_SECAO.exec(l);
      if (ms) { secao = ms[1].toLowerCase().replace(/strict\s+/, ''); continue; }
      if (RE_FIM_CLASSE.test(l)) { dentroClasse = false; continue; }
      const md = RE_DECL.exec(l);
      if (md) { out.metodos.push({ nome: md[1], linha: i, implementado: false }); continue; }
      const mf = RE_CAMPO.exec(l);
      if (mf && secao === 'published') {
        out.campos.push({ nome: mf[1], tipo: mf[2], linha: i });
      }
      continue;
    }

    const mi = RE_IMPL.exec(l);
    if (mi) {
      const existente = out.metodos.find(x => x.nome.toLowerCase() === mi[2].toLowerCase());
      if (existente) { existente.implementado = true; }
      else { out.metodos.push({ nome: mi[2], linha: i, implementado: true }); }
    }
  }

  return out;
}

/*
 * Não há checagem de begin/end aqui, e é deliberado.
 *
 * Contar blocos por palavra-chave marcou 35 de 150 units válidas do projeto como
 * desbalanceadas: `case` dentro de variant record fecha no `end` do próprio record,
 * `class var` e `class function` casam com o padrão sem abrir bloco, e `end.` fecha a unit
 * sem par. Um aviso que erra em 23% dos casos custa mais atenção do que economiza — isso
 * exige um parser de verdade, não uma contagem.
 */

export interface CrossIssue {
  linha: number;
  severidade: 'error' | 'warning' | 'info';
  mensagem: string;
  /** Onde o problema foi visto: no .pas ou no .dfm. */
  origem: 'pas' | 'dfm';
}

/**
 * Cruza a unit com o form: é aqui que aparecem os erros que o compilador não pega e que
 * derrubam a aplicação ao abrir a tela.
 */
export function crossCheck(
  unit: PasUnit,
  componentes: { nome: string; cls: string; linha: number }[],
  handlers: { nome: string; linha: number; prop: string }[],
): CrossIssue[] {
  const issues: CrossIssue[] = [];
  const campos = new Map(unit.campos.map(c => [c.nome.toLowerCase(), c]));
  const metodos = new Map(unit.metodos.map(m => [m.nome.toLowerCase(), m]));

  for (const c of componentes) {
    const campo = campos.get(c.nome.toLowerCase());
    if (!campo) {
      issues.push({
        linha: c.linha, origem: 'dfm', severidade: 'error',
        mensagem: `${c.nome} não está declarado na seção published de ` +
          `${unit.classe ?? unit.nome}: o form vai falhar ao carregar`,
      });
    } else if (campo.tipo.toLowerCase() !== c.cls.toLowerCase()) {
      issues.push({
        linha: c.linha, origem: 'dfm', severidade: 'warning',
        mensagem: `${c.nome} é ${c.cls} no form, mas ${campo.tipo} na classe`,
      });
    }
  }

  for (const h of handlers) {
    if (!metodos.has(h.nome.toLowerCase())) {
      issues.push({
        linha: h.linha, origem: 'dfm', severidade: 'error',
        mensagem: `${h.prop} aponta para ${h.nome}, que não existe em ` +
          `${unit.classe ?? unit.nome}`,
      });
    }
  }

  const noForm = new Set(componentes.map(c => c.nome.toLowerCase()));
  for (const campo of unit.campos) {
    // só reclama de tipos de componente: T* que não sejam tipos básicos
    if (!/^T[A-Z]/.test(campo.tipo) || noForm.has(campo.nome.toLowerCase())) { continue; }
    issues.push({
      linha: campo.linha, origem: 'pas', severidade: 'info',
      mensagem: `${campo.nome} está declarado como published mas não existe no .dfm`,
    });
  }

  for (const m of unit.metodos) {
    if (!m.implementado) {
      issues.push({
        linha: m.linha, origem: 'pas', severidade: 'error',
        mensagem: `${m.nome} está declarado mas não tem implementação nesta unit`,
      });
    }
  }

  const vistos = new Map<string, number>();
  for (const u of unit.uses) {
    const chave = u.nome.toLowerCase();
    if (vistos.has(chave)) {
      issues.push({
        linha: u.linha, origem: 'pas', severidade: 'warning',
        mensagem: `${u.nome} aparece duas vezes no uses`,
      });
    }
    vistos.set(chave, u.linha);
  }

  return issues;
}
