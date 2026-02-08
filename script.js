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
let aulasNaoAlocadas = [];
let relatorioFalhas = [];

function registrarFalha({ turma, disciplina, professor, motivo }) {
  relatorioFalhas.push({
    turma,
    disciplina,
    professor,
    motivo
  });
}




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

function lerCSV(file, callback) {
  const reader = new FileReader();
  reader.onload = e => {
    const linhas = e.target.result
      .split("\n")
      .map(l => l.trim())
      .filter(l => l.length > 0);

    const cabecalho = linhas[0].split(",").map(c => c.trim());
    const dados = linhas.slice(1).map(linha => {
      const valores = linha.split(",").map(v => v.trim());
      const obj = {};
      cabecalho.forEach((c, i) => obj[c] = valores[i] || "");
      return obj;
    });

    callback(dados);
  };
  reader.readAsText(file);
}

function importarTurmasCSV(file) {
  lerCSV(file, dados => {
    banco.turmas = dados.map(l => ({
      nome: l.turma,
      turno: l.turno,
      disciplinas: []
    }));

    salvar();
    atualizarSelects();
    alert("Turmas importadas com sucesso.");
  });
}

function importarProfessoresCSV(file) {
  lerCSV(file, dados => {
    banco.professores = dados.map(l => ({
      nome: l.nome,
      dias: l.dias
        .split(";")
        .map(d => d.trim())
        .filter(d => d.length > 0),
      restricoes: {
        aulasProibidas: {
          M: l.proibidas_M ? l.proibidas_M.split(";").map(Number) : [],
          V: l.proibidas_V ? l.proibidas_V.split(";").map(Number) : [],
          I: l.proibidas_I ? l.proibidas_I.split(";").map(Number) : [],
          EMR: l.proibidas_EMR ? l.proibidas_EMR.split(";").map(Number) : []
        }
      },
      preferencias: {
        aulasPreferidas: l.preferencias
          ? l.preferencias
            .split(";")
            .map(p => Number(p.trim()))
            .filter(n => !isNaN(n))
          : [],
        pesoPreferencia: 10
      }

    }));

    salvar();
    atualizarSelects();
    atualizarMedidor();
    alert("Professores importados com sucesso.");
  });
}

function importarDisciplinasCSV(file) {
  lerCSV(file, dados => {
    dados.forEach(l => {
      const turma = banco.turmas.find(t => t.nome === l.turma);
      if (!turma) return;

      turma.disciplinas.push({
        nome: l.disciplina,
        aulas: Number(l.aulas),
        professor: null,

        // número máximo de aulas seguidas
        agrupamento: Number(l.agrupamento || 1),

        // controle pedagógico de sequência
        permiteSequencia: String(l.permite_sequencia || "")
          .toLowerCase()
          .trim()
          .match(/^(true|1|sim|yes)$/) !== null
      });

    });

    salvar();
    alert("Disciplinas importadas.");
  });
}

function importarVinculosCSV(file) {
  lerCSV(file, dados => {
    dados.forEach(l => {
      const turma = banco.turmas.find(t => t.nome === l.turma);
      if (!turma) return;

      const disciplinas = l.disciplina
        .split(";")
        .map(d => d.trim())
        .filter(d => d.length > 0);

      disciplinas.forEach(nomeDisc => {
        const disc = turma.disciplinas.find(d => d.nome === nomeDisc);
        if (!disc) return;

        disc.professor = l.professor;
      });
    });

    salvar();
    alert("Vínculos aplicados com sucesso.");
  });
}


function importarCSV(tipo, input) {
  const file = input.files[0];
  if (!file) return;

  if (tipo === "turmas") importarTurmasCSV(file);
  if (tipo === "professores") importarProfessoresCSV(file);
  if (tipo === "disciplinas") importarDisciplinasCSV(file);
  if (tipo === "vinculos") importarVinculosCSV(file);

  input.value = "";
}

function validarCargaTurma(turma) {
  const total = turma.disciplinas.reduce(
    (s, d) => s + d.aulas,
    0
  );

  const capacidade = diasSemana.length * turnos[turma.turno];

  return {
    total,
    capacidade,
    ok: total <= capacidade
  };
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
  if (total >= 32) return 4;
  if (total >= 16) return 3;
  if (total <= 5) return 1;
  return 1
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

function disciplinaJaNoDia(turma, dia, disciplina) {
  return banco.horarios[turma]
    .some(s =>
      s.dia === dia &&
      s.disciplina === disciplina
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
function pontuacaoSlotPorNivel(slot, professor, turma, nivel, disciplina) {
  let score = 0;

  // ⭐ preferência de aula
  if (
    nivel === 1 &&
    professor.preferencias?.aulasPreferidas?.includes(slot.aula)
  ) {
    score += professor.preferencias.pesoPreferencia || 1;
  }

  // 🔁 penaliza repetir disciplina no mesmo dia
  if (
    !professor.preferencias?.permiteSequencia &&
    disciplinaJaNoDia(turma, slot.dia, disciplina)
  ) {
    score -= 5; // penalidade forte
  }

  // 📉 evita concentrar aulas do mesmo professor no dia
  score -= contarAulasNoDia(professor.nome, turma, slot.dia);

  // 🎲 desempate aleatório leve
  score += random() * 0.1;

  return score;
}


function filtrarPorPreferencia(candidatos, professor, nivel) {
  const prefs = professor.preferencias?.aulasPreferidas;

  // se não há preferências, retorna tudo
  if (!prefs || prefs.length === 0) return candidatos;

  // nível estrito: preferência é quase obrigatória
  if (nivel === 1) {
    const preferenciais = candidatos.filter(s =>
      prefs.includes(s.aula)
    );

    // se existir pelo menos um slot preferencial, usa SÓ eles
    if (preferenciais.length > 0) {
      return preferenciais;
    }
  }

  // níveis mais flexíveis: retorna tudo
  return candidatos;
}


// ===================================================
// PESO DE RESTRIÇÃO DO PROFESSOR
// ===================================================
function pesoRestricaoProfessor(professor) {
  // 🔒 BLINDAGEM ABSOLUTA
  if (!professor) return 9999;
  // professor inexistente = extremamente restrito

  const dias = professor.dias?.length || 0;

  const proibidasM = professor.restricoes?.aulasProibidas?.M?.length || 0;
  const proibidasV = professor.restricoes?.aulasProibidas?.V?.length || 0;
  const proibidasI = professor.restricoes?.aulasProibidas?.I?.length || 0;
  const proibidasEMR = professor.restricoes?.aulasProibidas?.EMR?.length || 0;

  const totalProibidas =
    proibidasM + proibidasV + proibidasI + proibidasEMR;

  const carga = calcularCargaProfessor(professor.nome);

  // peso maior = MAIS difícil de alocar
  return (
    (10 - dias) * 5 +     // poucos dias pesa muito
    totalProibidas * 3 +  // muitas aulas proibidas
    carga * 0.5           // carga alta
  );
}




// ===================================================
// GERAÇÃO (COM INCREMENTAL)
// ===================================================

function obterCandidatos(turma, professor, disc, nivel, modo) {
  let candidatos = banco.horarios[turma.nome].filter(s =>
    slotDisponivel(s) &&
    professor.dias.includes(s.dia)
  );

  // MODO 1 — regras completas
  if (modo === 1) {
    candidatos = candidatos.filter(s =>
      aulaPermitidaPorNivel(professor, s.aula, turma.turno, nivel)
    );

    if (!disc.permiteSequencia) {
      candidatos = candidatos.filter(s =>
        !disciplinaJaNoDia(turma.nome, s.dia, disc.nome)
      );
    }

    candidatos = filtrarPorPreferencia(candidatos, professor, nivel);
  }

  // MODO 2 — ignora preferência
  if (modo === 2) {
    if (!disc.permiteSequencia) {
      candidatos = candidatos.filter(s =>
        !disciplinaJaNoDia(turma.nome, s.dia, disc.nome)
      );
    }
  }

  // MODO 3 — só regras duras
  return candidatos;
}



function tentarGerarComNivel(nivel, seedBase) {
  setSeed(seedBase);
  inicializarHorarios();

  for (const turma of banco.turmas) {

    const disciplinasOrdenadas = [...turma.disciplinas].sort((a, b) => {
      const pa = banco.professores.find(p => p.nome === a.professor) || null;
      const pb = banco.professores.find(p => p.nome === b.professor) || null;
      return pesoRestricaoProfessor(pb) - pesoRestricaoProfessor(pa);
    });

    for (const disc of disciplinasOrdenadas) {

      // 🔒 disciplina sem professor
      if (!disc.professor) {
        registrarFalha({
          turma: turma.nome,
          disciplina: disc.nome,
          professor: "NÃO DEFINIDO",
          motivo: "Disciplina sem professor vinculado"
        });
        continue;
      }

      const professor = banco.professores.find(p => p.nome === disc.professor);

      // 🔒 professor inexistente
      if (!professor) {
        registrarFalha({
          turma: turma.nome,
          disciplina: disc.nome,
          professor: disc.professor,
          motivo: "Professor não cadastrado no sistema"
        });
        continue;
      }

      const blocos = Math.floor(disc.aulas / disc.agrupamento);
      let aulasAlocadas = 0;
      if (disc.aulas % disc.agrupamento !== 0) {
        registrarFalha({
          turma: turma.nome,
          disciplina: disc.nome,
          professor: professor.nome,
          motivo: "Quantidade de aulas incompatível com o agrupamento"
        });
      }


      // 🔁 LOOP ÚNICO DE ALOCAÇÃO
      for (let b = 0; b < blocos; b++) {

        let candidatos = [];

        // retry local progressivo
        for (let modo = 1; modo <= 3 && candidatos.length === 0; modo++) {
          candidatos = obterCandidatos(turma, professor, disc, nivel, modo);
        }

        if (candidatos.length === 0) continue;

        candidatos = embaralhar(candidatos);

        candidatos.sort((a, b) =>
          pontuacaoSlotPorNivel(
            b,
            professor,
            turma.nome,
            nivel,
            disc.nome
          ) -
          pontuacaoSlotPorNivel(
            a,
            professor,
            turma.nome,
            nivel,
            disc.nome
          )
        );

        let alocado = false;

        for (const slot of candidatos) {

          let conflito = false;

          for (let i = 0; i < disc.agrupamento; i++) {
            if (!professorLivre(
              professor.nome,
              slot.dia,
              faixaGlobal(turma.turno, slot.aula + i)
            )) {
              conflito = true;
              break;
            }
          }

          if (conflito) continue;

          // ✅ aloca bloco
          let aulasRealmenteAlocadas = 0;

          // tenta alocar aula por aula
          for (let i = 0; i < disc.agrupamento; i++) {
            const s = banco.horarios[turma.nome]
              .find(x => x.dia === slot.dia && x.aula === slot.aula + i);

            if (s && !s.professor) {
              s.professor = professor.nome;
              s.disciplina = disc.nome;
              aulasRealmenteAlocadas++;
            } else {
              break; // quebra sequência
            }
          }

          // só conta o que realmente entrou
          if (aulasRealmenteAlocadas > 0) {
            aulasAlocadas += aulasRealmenteAlocadas;
            alocado = true;
            break;
          }


          aulasAlocadas += disc.agrupamento;;
          alocado = true;
          break;
        }

        if (!alocado) continue;
      }

      // 📊 relatório FINAL da disciplina (único e correto)
      const faltam = disc.aulas - aulasAlocadas;

      if (faltam > 0) {

        aulasNaoAlocadas.push({
          turma: turma.nome,
          disciplina: disc.nome,
          professor: professor.nome,
          faltam
        });

        registrarFalha({
          turma: turma.nome,
          disciplina: disc.nome,
          professor: professor.nome,
          motivo: `Apenas ${aulasAlocadas}/${disc.aulas} aulas alocadas`
        });
      }

    }
  }

  return true;
}


// ===================================================
// GERADOR PRINCIPAL
// ===================================================
function gerarHorario() {
  relatorioFalhas = [];
  relatorioGeracao = { nivelUsado: null, ajustes: [] };
  const seedBase = banco.seedBase || Number(el("seed")?.value || Date.now());
  banco.seedBase = seedBase;
  for (const turma of banco.turmas) {
    const v = validarCargaTurma(turma);
    if (!v.ok) {
      alert(
        `Turma ${turma.nome} inviável:\n` +
        `Aulas: ${v.total} / Capacidade: ${v.capacidade}`
      );
      return;
    }
  }

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
  renderizarAulasNaoAlocadas();
  mostrarRelatorioGeracao();
  mostrarRelatorioFalhas();

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
        if (!slot?.disciplina) {
          html += `
    <td class="clicavel vazio"
        data-turma="${turma.nome}"
        data-dia="${dia}"
        data-aula="${aula}"
        ondragover="permitirDrop(event)"
        ondrop="onDrop(event)">
    </td>`;
        } else {
          html += `
    <td class="clicavel alocada"
    draggable="true"
    data-turma="${turma.nome}"
    data-dia="${dia}"
    data-aula="${aula}"
    data-disciplina="${slot.disciplina}"
    data-professor="${slot.professor}"
    ondragstart="onDragStartAlocada(event)"
    ondragend="onDragEndAlocada()"
    ondragover="permitirDrop(event)"
    ondrop="onDrop(event)"
    onclick="onClickCelula(event)">
  ${slot.disciplina}<br><small>${slot.professor}</small>
</td>
`;
        }
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
function onDragStartAlocada(e) {
  const td = e.target;

  const payload = {
    tipo: "alocada",
    turma: td.dataset.turma,
    dia: td.dataset.dia,
    aula: Number(td.dataset.aula),
    disciplina: td.dataset.disciplina,
    professor: td.dataset.professor
  };

  e.dataTransfer.setData("application/json", JSON.stringify(payload));
}

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

function mostrarRelatorioFalhas() {
  if (relatorioFalhas.length === 0) {
    alert("Horário gerado com sucesso, sem falhas 🎉");
    return;
  }

  let texto = "⚠️ Horário gerado com pendências:\n\n";

  relatorioFalhas.forEach(f => {
    texto +=
      `Turma: ${f.turma}\n` +
      `Disciplina: ${f.disciplina}\n` +
      `Professor: ${f.professor}\n` +
      `Motivo: ${f.motivo}\n\n`;
  });

  alert(texto);
}

// ===================================================
// INTERFACE
// ===================================================
function validarMovimento(aula, turmaDest, diaDest, aulaDest) {
  const turma = banco.turmas.find(t => t.nome === turmaDest);
  if (!turma) return false;

  const professor = banco.professores.find(p => p.nome === aula.professor);
  if (!professor) return false;

  const faixa = faixaGlobal(turma.turno, aulaDest);

  // regras duras
  if (!professor.dias.includes(diaDest)) return false;
  if (!professorLivre(professor.nome, diaDest, faixa)) return false;
  if (!aulaPermitidaPorNivel(professor, aulaDest, turma.turno, 1)) return false;

  const disc = turma.disciplinas.find(d => d.nome === aula.disciplina);
  if (!disc) return false;

  // regra pedagógica de sequência
  if (
    !disc.permiteSequencia &&
    disciplinaJaNoDia(turmaDest, diaDest, disc.nome)
  ) {
    return false;
  }

  return true;
}


function moverAulaAlocada(origem, turmaDest, diaDest, aulaDest) {

  const turmaOrig = origem.turma;
  const diaOrig = origem.dia;
  const aulaOrig = origem.aula;

  // mesmo lugar → ignora
  if (
    turmaOrig === turmaDest &&
    diaOrig === diaDest &&
    aulaOrig === aulaDest
  ) return;

  const slotOrig = banco.horarios[turmaOrig]
    .find(s => s.dia === diaOrig && s.aula === aulaOrig);

  const slotDest = banco.horarios[turmaDest]
    .find(s => s.dia === diaDest && s.aula === aulaDest);

  // valida destino
  if (!validarMovimento(origem, turmaDest, diaDest, aulaDest)) {
    alert("❌ Movimento inválido.");
    return;
  }

  // TROCA ou MOVE
  if (slotDest.disciplina) {
    // troca
    const tmp = {
      disciplina: slotDest.disciplina,
      professor: slotDest.professor
    };

    slotDest.disciplina = slotOrig.disciplina;
    slotDest.professor = slotOrig.professor;

    slotOrig.disciplina = tmp.disciplina;
    slotOrig.professor = tmp.professor;
  } else {
    // move simples
    slotDest.disciplina = slotOrig.disciplina;
    slotDest.professor = slotOrig.professor;

    slotOrig.disciplina = null;
    slotOrig.professor = null;
  }
}


function renderizarAulasNaoAlocadas() {
  const painel = el("painel-nao-alocadas");
  if (!painel) return;

  painel.innerHTML = "";

  let indiceGlobal = 0;

  aulasNaoAlocadas.forEach((item) => {

    // 🔁 CRIA UM BLOCO PARA CADA AULA REAL
    for (let i = 0; i < item.faltam; i++) {

      const div = document.createElement("div");
      div.className = "bloco-aula";
      div.draggable = true;

      div.dataset.index = indiceGlobal;

      div.innerHTML = `
        <strong>${item.disciplina}</strong><br>
        <small>${item.turma} • ${item.professor}</small>
      `;

      div.addEventListener("dragstart", (e) => {
        e.dataTransfer.setData(
          "application/json",
          JSON.stringify({
            tipo: "naoAlocada",
            index: indiceGlobal,
            turma: item.turma,
            disciplina: item.disciplina,
            professor: item.professor
          })
        );
      });

      painel.appendChild(div);
      indiceGlobal++;
    }
  });
}


function onDragStart(e) {
  e.dataTransfer.setData(
    "application/json",
    JSON.stringify({
      tipo: "naoAlocada",
      index: Number(e.target.dataset.index),
      ...aulasNaoAlocadas[e.target.dataset.index]
    })
  );
}

function permitirDrop(e) {
  e.preventDefault();
}

function onDrop(e) {
  e.preventDefault();

  const data = JSON.parse(e.dataTransfer.getData("application/json"));

  const turmaDestino = e.target.dataset.turma;
  const diaDestino = e.target.dataset.dia;
  const aulaDestino = Number(e.target.dataset.aula);

  if (data.tipo === "naoAlocada") {
    // já implementado antes (mantém)
    if (!validarDrop(data, turmaDestino, diaDestino, aulaDestino)) {
      alert("❌ Movimento inválido.");
      return;
    }

    aplicarDrop(data, turmaDestino, diaDestino, aulaDestino);
    const item = aulasNaoAlocadas.find(a =>
      a.turma === data.turma &&
      a.disciplina === data.disciplina &&
      a.professor === data.professor
    );

    if (item) {
      item.faltam--;

      if (item.faltam <= 0) {
        aulasNaoAlocadas = aulasNaoAlocadas.filter(a => a !== item);
      }
    }

  }

  if (data.tipo === "alocada") {
    moverAulaAlocada(data, turmaDestino, diaDestino, aulaDestino);
  }

  salvar();
  mostrarTodosHorarios();
  renderizarAulasNaoAlocadas();
}


function validarDrop(aula, turmaNome, dia, aulaNum) {
  const turma = banco.turmas.find(t => t.nome === turmaNome);
  const professor = banco.professores.find(p => p.nome === aula.professor);
  const faixa = faixaGlobal(turma.turno, aulaNum);

  if (!professor) return false;
  if (!professor.dias.includes(dia)) return false;
  if (!professorLivre(professor.nome, dia, faixa)) return false;
  if (!aulaPermitidaPorNivel(professor, aulaNum, turma.turno, 1)) return false;

  const disc = turma.disciplinas.find(d => d.nome === aula.disciplina);
  if (!disc) return false;

  if (!disc.permiteSequencia &&
    disciplinaJaNoDia(turmaNome, dia, disc.nome)) {
    return false;
  }

  return true;
}

function aplicarDrop(aula, turma, dia, aulaNum) {
  const slot = banco.horarios[turma]
    .find(s => s.dia === dia && s.aula === aulaNum);

  slot.disciplina = aula.disciplina;
  slot.professor = aula.professor;
}

let arrastando = false;

function onClickCelula(e) {
  if (arrastando) return;
  destacarProfessor(e.currentTarget);
}

function onDragStartAlocada(e) {
  arrastando = true;

  const td = e.target;

  const payload = {
    tipo: "alocada",
    turma: td.dataset.turma,
    dia: td.dataset.dia,
    aula: Number(td.dataset.aula),
    disciplina: td.dataset.disciplina,
    professor: td.dataset.professor
  };

  e.dataTransfer.setData("application/json", JSON.stringify(payload));
}

function onDragEndAlocada() {
  setTimeout(() => {
    arrastando = false;
  }, 50);
}



window.onload = () => {
  carregar();
  normalizarRestricoes();
  atualizarSelects();
  atualizarMedidor();
};
