// ===================================================
// CONFIGURAÇÕES GERAIS
// ===================================================
const diasSemana = ["Seg", "Ter", "Qua", "Qui", "Sex"];
const turnos = { M: 5, V: 5, I: 8 };

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
  horarios: {}
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
function cadastrarProfessor() {
  const nome = el("prof-nome").value.trim();
  const dias = [...document.querySelectorAll("input[type=checkbox]:checked")]
    .map(c => c.value);

  const aulasProibidas = el("prof-aulas-proibidas")?.value
    .split(",")
    .map(n => Number(n.trim()))
    .filter(n => !isNaN(n)) || [];

  const aulasPreferidas = el("prof-aulas-preferidas")?.value
    .split(",")
    .map(n => Number(n.trim()))
    .filter(n => !isNaN(n)) || [];

  if (!nome || dias.length === 0) {
    alert("Informe nome e dias disponíveis.");
    return;
  }

  banco.professores.push({
    nome,
    dias,
    restricoes: { aulasProibidas },
    preferencias: {
      aulasPreferidas,
      pesoPreferencia: 2
    }
  });

  salvar();
  atualizarSelects();
  atualizarMedidor();
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

    if (diasDisp < min) {
      classe = "vermelho";
      status = "Crítico";
    } else if (diasDisp === min) {
      classe = "amarelo";
      status = "Limite";
    }

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
          disciplina: null,
          professor: null
        });
      }
    });
  });
}

// ===================================================
// REGRAS
// ===================================================
function professorLivre(nome, dia, aula) {
  return !Object.values(banco.horarios)
    .flat()
    .some(s =>
      s.professor === nome &&
      s.dia === dia &&
      s.aula === aula
    );
}

function aulaPermitidaPorNivel(professor, aula, nivel) {
  if (nivel === 1) {
    return !professor.restricoes?.aulasProibidas?.includes(aula);
  }
  return true;
}

function contarAulasNoDia(nome, turma, dia) {
  return banco.horarios[turma]
    .filter(s => s.professor === nome && s.dia === dia)
    .length;
}

// ===================================================
// HEURÍSTICA POR NÍVEL
// ===================================================
function pontuacaoSlotPorNivel(slot, professor, turma, nivel) {
  let score = 0;

  if (nivel === 1) {
    if (professor.preferencias?.aulasPreferidas?.includes(slot.aula)) {
      score += professor.preferencias.pesoPreferencia || 1;
    }
  }

  score -= contarAulasNoDia(professor.nome, turma, slot.dia);
  score += random() * 0.1;

  return score;
}

// ===================================================
// TENTATIVA DE GERAÇÃO POR NÍVEL
// ===================================================
function tentarGerarComNivel(nivel, seedBase) {
  const MAX_TENTATIVAS = 25;

  for (let tentativa = 1; tentativa <= MAX_TENTATIVAS; tentativa++) {
    try {
      setSeed(seedBase + tentativa);
      inicializarHorarios();

      for (const turma of banco.turmas) {
        for (const disc of turma.disciplinas) {
          const professor = banco.professores.find(p => p.nome === disc.professor);
          const blocos = disc.aulas / disc.agrupamento;

          for (let b = 0; b < blocos; b++) {
            let candidatos = banco.horarios[turma.nome]
              .filter(s =>
                !s.professor &&
                professor.dias.includes(s.dia) &&
                aulaPermitidaPorNivel(professor, s.aula, nivel)
              );

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
                  slot.aula + i
                )) {
                  conflito = true;
                  break;
                }
              }

              if (conflito) continue;

              for (let i = 0; i < disc.agrupamento; i++) {
                const s = banco.horarios[turma.nome]
                  .find(x =>
                    x.dia === slot.dia &&
                    x.aula === slot.aula + i
                  );
                s.professor = professor.nome;
                s.disciplina = disc.nome;
              }

              alocado = true;
              break;
            }

            if (!alocado) throw new Error("Falha");
          }
        }
      }

      return true;

    } catch (e) {}
  }

  return false;
}

// ===================================================
// GERADOR PRINCIPAL (3 NÍVEIS + RELATÓRIO)
// ===================================================
function gerarHorario() {
  relatorioGeracao = { nivelUsado: null, ajustes: [] };
  const seedBase = Number(el("seed")?.value || Date.now());

  if (tentarGerarComNivel(1, seedBase)) {
    relatorioGeracao.nivelUsado = "Estrito";
  } else if (tentarGerarComNivel(2, seedBase)) {
    relatorioGeracao.nivelUsado = "Flexível";
    relatorioGeracao.ajustes.push(
      "Restrições de aulas proibidas foram ignoradas."
    );
  } else if (tentarGerarComNivel(3, seedBase)) {
    relatorioGeracao.nivelUsado = "Emergencial";
    relatorioGeracao.ajustes.push(
      "Restrições e preferências foram ignoradas."
    );
  } else {
    alert("❌ Nenhum horário possível, nem em modo emergencial.");
    return;
  }

  salvar();
  mostrarTodosHorarios();
  mostrarRelatorioGeracao();
}

// ===================================================
// RELATÓRIO
// ===================================================
function mostrarRelatorioGeracao() {
  let msg = `Horário gerado no modo: ${relatorioGeracao.nivelUsado}\n`;

  if (relatorioGeracao.ajustes.length > 0) {
    msg += "\nAjustes realizados:\n";
    relatorioGeracao.ajustes.forEach(a => msg += `- ${a}\n`);
  }

  alert(msg);
}

// ===================================================
// VISUALIZAÇÃO DOS HORÁRIOS
// ===================================================
function mostrarTodosHorarios() {
  const container = el("horarios");
  if (!container) return;

  container.innerHTML = "";

  banco.turmas.forEach(turma => {
    container.innerHTML += `<h3>Turma ${turma.nome}</h3>`;

    let html = `
      <table>
        <tr>
          <th>Aula</th>
          ${diasSemana.map(d => `<th>${d}</th>`).join("")}
        </tr>`;

    for (let aula = 1; aula <= turnos[turma.turno]; aula++) {
      html += `<tr><td>${aula}ª</td>`;

      diasSemana.forEach(dia => {
        const slot = banco.horarios[turma.nome]
          .find(s => s.dia === dia && s.aula === aula);

        html += `
          <td class="clicavel"
              data-professor="${slot?.professor || ""}"
              onclick="destacarProfessor(this)">
            ${slot?.disciplina || ""}
            <br>
            <small>${slot?.professor || ""}</small>
          </td>`;
      });

      html += `</tr>`;
    }

    html += `</table>`;
    container.innerHTML += html;
  });
}

// ===================================================
// DESTAQUES MULTI-PROFESSOR (16 CORES)
// ===================================================
const CORES_DESTAQUE = [
  "destaque-0","destaque-1","destaque-2","destaque-3",
  "destaque-4","destaque-5","destaque-6","destaque-7",
  "destaque-8","destaque-9","destaque-10","destaque-11",
  "destaque-12","destaque-13","destaque-14","destaque-15"
];

let destaquesAtivos = {};

function destacarProfessor(celula) {
  const prof = celula.dataset.professor;
  if (!prof) return;

  if (destaquesAtivos[prof]) {
    removerDestaque(prof);
    return;
  }

  const cor = CORES_DESTAQUE.find(
    c => !Object.values(destaquesAtivos).includes(c)
  );

  if (!cor) return alert("Limite de destaques.");

  destaquesAtivos[prof] = cor;
  document
    .querySelectorAll(`td[data-professor="${prof}"]`)
    .forEach(td => td.classList.add(cor, "destaque-borda"));
}

function removerDestaque(prof) {
  const cor = destaquesAtivos[prof];
  document
    .querySelectorAll(`td[data-professor="${prof}"]`)
    .forEach(td => td.classList.remove(cor, "destaque-borda"));
  delete destaquesAtivos[prof];
}

// ===================================================
// INTERFACE
// ===================================================
function atualizarSelects() {
  el("disc-turma").innerHTML = banco.turmas
    .map(t => `<option>${t.nome}</option>`)
    .join("");

  el("disc-professor").innerHTML = banco.professores
    .map(p => `<option>${p.nome}</option>`)
    .join("");
}

function limparDados() {
  localStorage.clear();
  location.reload();
}

// ===================================================
// INIT
// ===================================================
window.onload = () => {
  carregar();
  atualizarSelects();
  atualizarMedidor();
};
