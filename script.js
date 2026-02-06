// ===================================================
// CONFIGURAÇÕES GERAIS
// ===================================================
const diasSemana = ["Seg", "Ter", "Qua", "Qui", "Sex"];
const turnos = { M: 5, V: 5, I: 8, EMR: 6 };

// ===================================================
// MAPA DE FAIXA GLOBAL DE HORÁRIO
// ===================================================
function faixaGlobal(turno, aula) {
  if (turno === "M") return aula; // 1–5 manhã

  if (turno === "I") {
    if (aula <= 5) return aula;   // manhã
    return 5 + (aula - 5);        // tarde 1–3 → 6–8
  }

  if (turno === "V") return 5 + aula;   // 6–10
  if (turno === "EMR") return 5 + aula; // 6–11

  return null;
}


// ===================================================
// GERADOR ALEATÓRIO COM SEED
// ===================================================
let seedAtual = Date.now();

function setSeed(valor) {
  seedAtual = valor;
}

function random() {
  seedAtual = (seedAtual * 9301 + 49297) % 233280;
  return seedAtual / 233280;
}

// ===================================================
// BANCO DE DADOS
// ===================================================
let banco = {
  professores: [],
  turmas: [],
  horarios: {},
  seedBase: null
};

let relatorioGeracao = {
  nivelUsado: null,
  ajustes: []
};

// ===================================================
// PERSISTÊNCIA
// ===================================================
function salvar() {
  localStorage.setItem("horarioEscolar", JSON.stringify(banco));
}

function carregar() {
  const dados = localStorage.getItem("horarioEscolar");
  if (dados) banco = JSON.parse(dados);
}

// ===================================================
// UTILITÁRIOS
// ===================================================
function el(id) {
  return document.getElementById(id);
}

function embaralhar(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

// ===================================================
// CADASTRO DE PROFESSORES
// ===================================================

let professorEmEdicao = null;

function carregarProfessorParaEdicao() {
  const nome = el("prof-editar").value;
  professorEmEdicao = banco.professores.find(p => p.nome === nome);

  if (!professorEmEdicao) {
    limparFormularioProfessor();
    return;
  }

  // nome
  el("prof-nome").value = professorEmEdicao.nome;

  // dias
  document.querySelectorAll("input[type=checkbox]").forEach(cb => {
    cb.checked = professorEmEdicao.dias.includes(cb.value);
  });

  // restrições por turno
  el("prof-proibidas-m").value =
    professorEmEdicao.restricoes?.aulasProibidas?.M?.join(",") || "";

  el("prof-proibidas-v").value =
    professorEmEdicao.restricoes?.aulasProibidas?.V?.join(",") || "";

  el("prof-proibidas-i").value =
    professorEmEdicao.restricoes?.aulasProibidas?.I?.join(",") || "";

  el("prof-proibidas-emr").value =
    professorEmEdicao.restricoes?.aulasProibidas?.EMR?.join(",") || "";
}
function limparFormularioProfessor() {
  professorEmEdicao = null;
  el("prof-nome").value = "";
  el("prof-proibidas-m").value = "";
  el("prof-proibidas-v").value = "";
  el("prof-proibidas-i").value = "";
  el("prof-proibidas-emr").value = "";

  document.querySelectorAll("input[type=checkbox]").forEach(cb => {
    cb.checked = false;
  });
}


function parseLista(id) {
  return el(id)?.value
    .split(",")
    .map(n => Number(n.trim()))
    .filter(n => !isNaN(n)) || [];
}

function salvarProfessor() {
  const nome = el("prof-nome").value.trim();
  const dias = [...document.querySelectorAll("input[type=checkbox]:checked")]
    .map(c => c.value);

  if (!nome || dias.length === 0) {
    alert("Informe nome e dias disponíveis.");
    return;
  }

  const proibidasM = parseLista("prof-proibidas-m");
  const proibidasV = parseLista("prof-proibidas-v");
  const proibidasI = parseLista("prof-proibidas-i");
  const proibidasEMR = parseLista("prof-proibidas-emr");

  const dados = {
    nome,
    dias,
    restricoes: {
      aulasProibidas: {
        M: proibidasM,
        V: proibidasV,
        I: proibidasI,
        EMR: proibidasEMR
      }
    },
    preferencias: {
      aulasPreferidas: [],
      pesoPreferencia: 2
    }
  };

  if (professorEmEdicao) {
    // 🔁 ATUALIZA professor existente
    Object.assign(professorEmEdicao, dados);
  } else {
    // ➕ NOVO professor
    banco.professores.push(dados);
  }

  salvar();
  atualizarSelects();
  atualizarMedidor();
  limparFormularioProfessor();
}


// ===================================================
// CADASTRO DE TURMAS E DISCIPLINAS
// ===================================================
function cadastrarTurma() {
  const nome = el("turma-nome").value.trim();
  const turno = el("turma-turno").value;
  if (!nome) return alert("Informe o nome da turma.");

  banco.turmas.push({ nome, turno, disciplinas: [] });
  salvar();
  atualizarSelects();
}

function adicionarDisciplina() {
  const turmaNome = el("disc-turma").value;
  const nome = el("disc-nome").value.trim();
  const aulas = Number(el("disc-aulas").value);
  const professor = el("disc-professor").value;
  const agrupamento = Number(el("disc-agrupamento").value || 1);

  if (!turmaNome || !nome || !aulas || !professor)
    return alert("Dados incompletos.");

  if (aulas % agrupamento !== 0)
    return alert("Aulas incompatíveis com o agrupamento.");

  const turma = banco.turmas.find(t => t.nome === turmaNome);
  turma.disciplinas.push({ nome, aulas, professor, agrupamento });

  salvar();
  atualizarMedidor();
}

// ===================================================
// MEDIDOR (DIAGNÓSTICO)
// ===================================================
function calcularCargaProfessor(nome) {
  let total = 0;
  banco.turmas.forEach(t =>
    t.disciplinas.forEach(d => {
      if (d.professor === nome) total += d.aulas;
    })
  );
  return total;
}

function diasMinimosRecomendados(total) {
  if (total <= 2) return 2;
  if (total <= 4) return 4;
  return 5;
}

function atualizarMedidor() {
  const div = el("medidor");
  if (!div) return;
  div.innerHTML = "";

  banco.professores.forEach(p => {
    const total = calcularCargaProfessor(p.nome);
    const diasDisp = p.dias.length;
    const min = diasMinimosRecomendados(total);

    let classe = "verde";
    let status = "OK";
    if (diasDisp < min) { classe = "vermelho"; status = "Crítico"; }
    else if (diasDisp === min) { classe = "amarelo"; status = "Limite"; }

    div.innerHTML += `
      <div class="medidor-item ${classe}">
        <strong>${p.nome}</strong><br>
        Aulas: ${total} | Dias: ${diasDisp} | Min: ${min} → ${status}
      </div>`;
  });
}

// ===================================================
// INICIALIZAÇÃO DOS HORÁRIOS
// ===================================================
function inicializarHorarios() {
  banco.horarios = {};
  banco.turmas.forEach(turma => {
    banco.horarios[turma.nome] = [];
    diasSemana.forEach(dia => {
      for (let aula = 1; aula <= turnos[turma.turno]; aula++) {
        banco.horarios[turma.nome].push({
          dia,
          aula,
          turno: turma.turno,
          faixa: faixaGlobal(turma.turno, aula),
          disciplina: null,
          professor: null,
          fixo: false
        });

      }
    });
  });
}

function inicializarHorariosIncremental() {
  // se não existe OU se não tem esta turma, inicializa tudo
  if (
    !banco.horarios ||
    Object.keys(banco.horarios).length === 0
  ) {
    inicializarHorarios();
    return;
  }

  // garante que TODAS as turmas tenham slots
  banco.turmas.forEach(turma => {
    if (!banco.horarios[turma.nome] ||
      banco.horarios[turma.nome].length === 0) {

      banco.horarios[turma.nome] = [];
      diasSemana.forEach(dia => {
        for (let aula = 1; aula <= turnos[turma.turno]; aula++) {
          banco.horarios[turma.nome].push({
            dia,
            aula,
            turno: turma.turno,
            faixa: faixaGlobal(turma.turno, aula),
            disciplina: null,
            professor: null,
            fixo: false
          });

        }
      });
    }
  });
}


function slotDisponivel(slot) {
  return !slot.professor && slot.fixo !== true;
}

// ===================================================
// REGRAS
// ===================================================
function professorLivre(nome, dia, faixa) {
  return !Object.values(banco.horarios).flat().some(s =>
    s.professor === nome &&
    s.dia === dia &&
    s.faixa === faixa
  );
}


function aulaPermitidaPorNivel(professor, aula, turno, nivel) {
  if (nivel !== 1) return true;

  const restricoes = professor.restricoes?.aulasProibidas;
  if (!restricoes) return true;

  const proibidasNoTurno = restricoes[turno] || [];
  return !proibidasNoTurno.includes(aula);
}

function contarAulasNoDia(nome, turma, dia) {
  return banco.horarios[turma]
    .filter(s => s.professor === nome && s.dia === dia).length;
}

// ===================================================
// HEURÍSTICA
// ===================================================
function pontuacaoSlotPorNivel(slot, professor, turma, nivel) {
  let score = 0;
  if (nivel === 1 &&
    professor.preferencias?.aulasPreferidas?.includes(slot.aula))
    score += professor.preferencias.pesoPreferencia || 1;

  score -= contarAulasNoDia(professor.nome, turma, slot.dia);
  score += random() * 0.1;
  return score;
}

// ===================================================
// GERAÇÃO (COM INCREMENTAL)
// ===================================================
function tentarGerarComNivel(nivel, seedBase) {
  const MAX_TENTATIVAS = 10000;

  for (let tentativa = 1; tentativa <= MAX_TENTATIVAS; tentativa++) {
    try {
      setSeed(seedBase + tentativa);
      inicializarHorarios();

      for (const turma of banco.turmas) {
        const disciplinasOrdenadas = [...turma.disciplinas].sort((a, b) => {
          const pa = banco.professores.find(p => p.nome === a.professor);
          const pb = banco.professores.find(p => p.nome === b.professor);

          // professores com MENOS dias disponíveis vêm primeiro
          return pa.dias.length - pb.dias.length;
        });

        for (const disc of disciplinasOrdenadas) {
          const professor = banco.professores.find(p => p.nome === disc.professor);
          const blocos = disc.aulas / disc.agrupamento;

          let ja = banco.horarios[turma.nome]
            .filter(s => s.professor === professor.nome && s.disciplina === disc.nome)
            .length / disc.agrupamento;

          for (let b = ja; b < blocos; b++) {
            let candidatos = banco.horarios[turma.nome]
              .filter(s =>
                slotDisponivel(s) &&
                professor.dias.includes(s.dia) &&
                aulaPermitidaPorNivel(
                  professor,
                  s.aula,
                  turma.turno,
                  nivel
                )
              );

            if (candidatos.length === 0 && nivel === 1) {
              // tenta ignorar aulas proibidas localmente
              candidatos = banco.horarios[turma.nome]
                .filter(s =>
                  slotDisponivel(s) &&
                  professor.dias.includes(s.dia)
                );
            }


            candidatos = embaralhar(candidatos);
            candidatos.sort((a, b) =>
              pontuacaoSlotPorNivel(b, professor, turma.nome, nivel) -
              pontuacaoSlotPorNivel(a, professor, turma.nome, nivel)
            );

            let alocado = false;

            for (const slot of candidatos) {
              let conflito = false;
              for (let i = 0; i < disc.agrupamento; i++) {
                if (!professorLivre(
                  professor.nome,
                  slot.dia,
                  faixaGlobal(turma.turno, slot.aula + i))) {
                  conflito = true; break;
                }
              }
              if (conflito) continue;

              for (let i = 0; i < disc.agrupamento; i++) {
                const s = banco.horarios[turma.nome]
                  .find(x => x.dia === slot.dia && x.aula === slot.aula + i);
                s.professor = professor.nome;
                s.disciplina = disc.nome;
              }

              alocado = true;
              break;
            }
            if (!alocado) throw "falha";
          }
        }
      }
      return true;
    } catch { }
  }
  return false;
}

// ===================================================
// GERADOR PRINCIPAL
// ===================================================
function gerarHorario() {
  relatorioGeracao = { nivelUsado: null, ajustes: [] };
  const seedBase = banco.seedBase || Number(el("seed")?.value || Date.now());
  banco.seedBase = seedBase;

  if (tentarGerarComNivel(1, seedBase)) {
    relatorioGeracao.nivelUsado = "Estrito";
  } else if (tentarGerarComNivel(2, seedBase)) {
    relatorioGeracao.nivelUsado = "Flexível";
  } else if (tentarGerarComNivel(3, seedBase)) {
    relatorioGeracao.nivelUsado = "Emergencial";
  } else {
    alert("❌ Nenhum horário possível.");
    return;
  }

  salvar();
  mostrarTodosHorarios();
  mostrarRelatorioGeracao();
}

function gerarComNovaSeed() {
  banco.seedBase = Date.now(); // nova seed
  salvar();
  gerarHorario();
}

// ===================================================
// CONGELAMENTO
// ===================================================
function congelarHorarioAtual() {
  Object.values(banco.horarios).flat().forEach(s => {
    if (s.professor) s.fixo = true;
  });
  salvar();
  alert("Horário congelado.");
}

// ===================================================
// RELATÓRIO
// ===================================================
function mostrarRelatorioGeracao() {
  alert(`Horário gerado no modo: ${relatorioGeracao.nivelUsado}`);
}

// ===================================================
// VISUALIZAÇÃO
// ===================================================
function mostrarTodosHorarios() {
  const container = el("horarios");
  if (!container) return;
  container.innerHTML = "";

  banco.turmas.forEach(turma => {
    container.innerHTML += `<h3>Turma ${turma.nome}</h3>`;
    let html = `<table><tr><th>Aula</th>${diasSemana.map(d => `<th>${d}</th>`).join("")}</tr>`;

    for (let aula = 1; aula <= turnos[turma.turno]; aula++) {
      html += `<tr><td>${aula}ª</td>`;
      diasSemana.forEach(dia => {
        const slot = banco.horarios[turma.nome].find(s => s.dia === dia && s.aula === aula);
        html += `
          <td class="clicavel" data-professor="${slot?.professor || ""}"
              onclick="destacarProfessor(this)">
            ${slot?.disciplina || ""}<br><small>${slot?.professor || ""}</small>
          </td>`;
      });
      html += `</tr>`;
    }
    html += `</table>`;
    container.innerHTML += html;
  });
}

// ===================================================
// DESTAQUES (16 CORES)
// ===================================================
const CORES_DESTAQUE = Array.from({ length: 16 }, (_, i) => `destaque-${i}`);
let destaquesAtivos = {};

function destacarProfessor(celula) {
  const prof = celula.dataset.professor;
  if (!prof) return;

  if (destaquesAtivos[prof]) {
    removerDestaque(prof);
    return;
  }

  const cor = CORES_DESTAQUE.find(c => !Object.values(destaquesAtivos).includes(c));
  if (!cor) return alert("Limite de destaques.");

  destaquesAtivos[prof] = cor;
  document.querySelectorAll(`td[data-professor="${prof}"]`)
    .forEach(td => td.classList.add(cor, "destaque-borda"));
}

function removerDestaque(prof) {
  const cor = destaquesAtivos[prof];
  document.querySelectorAll(`td[data-professor="${prof}"]`)
    .forEach(td => td.classList.remove(cor, "destaque-borda"));
  delete destaquesAtivos[prof];
}

// ===================================================
// INTERFACE
// ===================================================
function atualizarSelects() {
  // select de disciplinas
  el("disc-turma").innerHTML =
    banco.turmas.map(t => `<option>${t.nome}</option>`).join("");

  el("disc-professor").innerHTML =
    banco.professores.map(p => `<option>${p.nome}</option>`).join("");

  // select de edição de professor
  const selEdit = el("prof-editar");
  if (selEdit) {
    selEdit.innerHTML =
      `<option value="">-- Novo professor --</option>` +
      banco.professores
        .map(p => `<option value="${p.nome}">${p.nome}</option>`)
        .join("");
  }
}


function limparDados() {
  localStorage.clear();
  location.reload();
}

// ===================================================
// INIT
// ===================================================

function normalizarRestricoes() {
  banco.professores.forEach(p => {
    const r = p.restricoes?.aulasProibidas;

    // formato antigo → novo
    if (Array.isArray(r)) {
      p.restricoes.aulasProibidas = {
        M: [...r],
        V: [...r]
      };
    }

    // formato parcial
    if (!p.restricoes.aulasProibidas.M)
      p.restricoes.aulasProibidas.M = [];

    if (!p.restricoes.aulasProibidas.V)
      p.restricoes.aulasProibidas.V = [];
  });
}


window.onload = () => {
  carregar();
  normalizarRestricoes();
  atualizarSelects();
  atualizarMedidor();
};
