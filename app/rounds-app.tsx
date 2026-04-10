"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import rawAdultsQuestions from "./questions-adults.json";
import rawKidsQuestions from "./questions.json";

type QuestionSource = {
  name: string;
  questionRu?: string;
  questionEn?: string;
};

type Question = {
  name: string;
  textRu: string;
  textEn: string;
  used: boolean;
};

type QuestionSetId = "kids" | "adults";

type QuestionSet = {
  id: QuestionSetId;
  title: string;
  questions: Question[];
};

type Phase = "idle" | "running" | "between" | "finished";
type Pairing = {
  left: string;
  right: string | null;
};

const BYE = "__BYE__";

function clampInt(value: number, min: number, max: number) {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, Math.trunc(value)));
}

function formatSeconds(totalSeconds: number) {
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

function normalizeQuestions(source: unknown): Question[] {
  if (!Array.isArray(source)) return [];
  return (source as QuestionSource[])
    .filter((q) => q && typeof q.name === "string" && q.name.trim().length > 0)
    .map((q) => ({
      name: q.name.trim(),
      textRu:
        typeof q.questionRu === "string" && q.questionRu.trim().length > 0
          ? q.questionRu.trim()
          : q.name.trim(),
      textEn:
        typeof q.questionEn === "string" && q.questionEn.trim().length > 0
          ? q.questionEn.trim()
          : q.name.trim(),
      used: false,
    }));
}

function normalizeParticipants(source: string) {
  return source
    .split(/\r?\n|,/)
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function buildRoundPairings(participants: string[], roundIndex: number): Pairing[] {
  if (participants.length === 0) return [];

  const padded =
    participants.length % 2 === 0 ? [...participants] : [...participants, BYE];
  const ordered = new Array<string>(padded.length);

  for (let idx = 0; idx < padded.length / 2; idx += 1) {
    ordered[idx] = padded[idx * 2];
    ordered[padded.length - 1 - idx] = padded[idx * 2 + 1];
  }

  const cycleLength = Math.max(1, ordered.length - 1);
  const effectiveRound = ((roundIndex % cycleLength) + cycleLength) % cycleLength;
  let arrangement = [...ordered];

  for (let step = 0; step < effectiveRound; step += 1) {
    arrangement = [
      arrangement[0],
      arrangement[arrangement.length - 1],
      ...arrangement.slice(1, -1),
    ];
  }

  const pairings: Pairing[] = [];
  for (let idx = 0; idx < arrangement.length / 2; idx += 1) {
    const left = arrangement[idx];
    const right = arrangement[arrangement.length - 1 - idx];
    if (left === BYE && right === BYE) continue;
    if (left === BYE) {
      pairings.push({ left: right, right: null });
      continue;
    }
    if (right === BYE) {
      pairings.push({ left, right: null });
      continue;
    }
    pairings.push({ left, right });
  }

  return pairings;
}

function getPairingCycleLength(participants: string[]) {
  if (participants.length <= 1) return participants.length;
  return participants.length % 2 === 0 ? participants.length - 1 : participants.length;
}

const QUESTION_SETS: QuestionSet[] = [
  {
    id: "kids",
    title: "for kids",
    questions: normalizeQuestions(rawKidsQuestions),
  },
  {
    id: "adults",
    title: "for adults",
    questions: normalizeQuestions(rawAdultsQuestions),
  },
];

export default function RoundsApp() {
  const [selectedSetId, setSelectedSetId] = useState<QuestionSetId | null>(null);
  const [questions, setQuestions] = useState<Question[]>([]);
  const [phase, setPhase] = useState<Phase>("idle");
  const [roundSeconds, setRoundSeconds] = useState<number>(180);
  const [participantsInput, setParticipantsInput] = useState<string>("");
  const [startedRounds, setStartedRounds] = useState<number>(0);
  const [activeQuestionIndex, setActiveQuestionIndex] = useState<number | null>(
    null,
  );
  const [remainingSeconds, setRemainingSeconds] = useState<number>(0);
  const [isPaused, setIsPaused] = useState<boolean>(false);
  const [hoverPreview, setHoverPreview] = useState<string>("");
  const [nextQuestionIndex, setNextQuestionIndex] = useState<number | null>(
    null,
  );

  const timerId = useRef<number | null>(null);
  const roundEndAtMs = useRef<number | null>(null);

  const nextRoundLabel = useMemo(
    () => `Start next round (${formatSeconds(roundSeconds)})`,
    [roundSeconds],
  );

  const selectedSet = useMemo(
    () =>
      selectedSetId == null
        ? null
        : QUESTION_SETS.find((set) => set.id === selectedSetId) ?? null,
    [selectedSetId],
  );

  const participants = useMemo(
    () => normalizeParticipants(participantsInput),
    [participantsInput],
  );

  const activeQuestion = useMemo(() => {
    if (activeQuestionIndex == null) return null;
    const q = questions[activeQuestionIndex];
    return q ?? null;
  }, [activeQuestionIndex, questions]);

  const hasAnyEnabledUnused = useMemo(
    () => questions.some((q) => !q.used),
    [questions],
  );

  const effectiveNextIndex = useMemo(() => {
    if (nextQuestionIndex != null) {
      const selected = questions[nextQuestionIndex];
      if (selected && !selected.used) return nextQuestionIndex;
    }
    const fallbackIndex = questions.findIndex((q) => !q.used);
    return fallbackIndex === -1 ? null : fallbackIndex;
  }, [questions, nextQuestionIndex]);

  const nextQuestionPreview = useMemo(() => {
    if (effectiveNextIndex == null) return "";
    const q = questions[effectiveNextIndex];
    return q ? `${q.textEn} / ${q.textRu}` : "";
  }, [effectiveNextIndex, questions]);

  const pairingRoundIndex = useMemo(() => {
    if (phase === "running") {
      return Math.max(startedRounds - 1, 0);
    }
    return startedRounds;
  }, [phase, startedRounds]);

  const currentPairings = useMemo(
    () => buildRoundPairings(participants, pairingRoundIndex),
    [pairingRoundIndex, participants],
  );

  const pairingSchedule = useMemo(() => {
    const cycleLength = getPairingCycleLength(participants);
    return Array.from({ length: cycleLength }, (_, roundIndex) => ({
      round: roundIndex + 1,
      pairings: buildRoundPairings(participants, roundIndex),
    }));
  }, [participants]);

  useEffect(() => {
    return () => {
      if (timerId.current != null) window.clearInterval(timerId.current);
    };
  }, []);

  function stopTimer() {
    if (timerId.current != null) {
      window.clearInterval(timerId.current);
      timerId.current = null;
    }
    roundEndAtMs.current = null;
  }

  function startTimer(seconds: number) {
    stopTimer();
    const endAt = Date.now() + seconds * 1000;
    roundEndAtMs.current = endAt;
    setRemainingSeconds(seconds);
    setIsPaused(false);

    timerId.current = window.setInterval(() => {
      const end = roundEndAtMs.current;
      if (end == null) return;

      const msLeft = end - Date.now();
      const nextRemaining = clampInt(Math.ceil(msLeft / 1000), 0, 24 * 60 * 60);
      setRemainingSeconds(nextRemaining);

      if (nextRemaining <= 0) {
        stopTimer();
        setActiveQuestionIndex(null);
        setIsPaused(false);
        setPhase("between");
      }
    }, 200);
  }

  function pauseTimer() {
    if (phase !== "running") return;
    if (timerId.current == null) return;
    stopTimer();
    setIsPaused(true);
  }

  function resumeTimer() {
    if (phase !== "running") return;
    if (!isPaused) return;
    startTimer(remainingSeconds);
  }

  function stopRoundEarly() {
    if (phase !== "running") return;
    stopTimer();
    setRemainingSeconds(0);
    setIsPaused(false);
    setActiveQuestionIndex(null);
    setPhase("between");
  }

  function resetTimerToFull() {
    if (phase !== "running") return;
    const next = clampInt(roundSeconds, 1, 60 * 60);
    if (isPaused) {
      stopTimer();
      setRemainingSeconds(next);
      setIsPaused(true);
      return;
    }
    startTimer(next);
  }

  function resetAll() {
    stopTimer();
    setIsPaused(false);
    setRemainingSeconds(0);
    setActiveQuestionIndex(null);
    setStartedRounds(0);
    setPhase("idle");
    setQuestions((prev) => prev.map((q) => ({ ...q, used: false })));
  }

  function chooseQuestionSet(setId: QuestionSetId) {
    const nextSet = QUESTION_SETS.find((set) => set.id === setId);
    if (!nextSet) return;
    stopTimer();
    setSelectedSetId(setId);
    setQuestions(nextSet.questions.map((q) => ({ ...q, used: false })));
    setPhase("idle");
    setRemainingSeconds(0);
    setIsPaused(false);
    setStartedRounds(0);
    setActiveQuestionIndex(null);
    setHoverPreview("");
    setNextQuestionIndex(null);
  }

  function startNextRound() {
    if (selectedSetId == null) return;
    if (!hasAnyEnabledUnused) {
      setPhase("finished");
      setActiveQuestionIndex(null);
      stopTimer();
      return;
    }

    const preferred =
      effectiveNextIndex != null && questions[effectiveNextIndex] && !questions[effectiveNextIndex].used
        ? effectiveNextIndex
        : null;

    const nextIndex =
      preferred ?? questions.findIndex((q) => !q.used);
    if (nextIndex === -1) {
      setPhase("finished");
      setActiveQuestionIndex(null);
      stopTimer();
      return;
    }

    setQuestions((prev) =>
      prev.map((q, idx) => (idx === nextIndex ? { ...q, used: true } : q)),
    );
    setStartedRounds((prev) => prev + 1);
    setActiveQuestionIndex(nextIndex);
    setPhase("running");
    startTimer(roundSeconds);

    setNextQuestionIndex((prev) => {
      if (prev === nextIndex) return null;
      return prev;
    });
  }

  return (
    <div className="appRoot">
      <div className="displayArea">
        <div className="displayMain">
          {participants.length > 0 && selectedSet == null ? (
            <div className="pairingsSchedule">
              {pairingSchedule.map((round) => (
                <div key={round.round} className="pairingsPanel">
                  <div className="pairingsTitle">Round {round.round}</div>
                  <div className="pairingsList">
                    {round.pairings.map((pairing, idx) => (
                      <div key={`${pairing.left}-${pairing.right ?? "idle"}-${idx}`} className="pairingChip">
                        {pairing.right == null
                          ? `${pairing.left} - idle`
                          : `${pairing.left} - ${pairing.right}`}
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          ) : null}

          {participants.length > 0 &&
          selectedSet != null &&
          phase !== "running" ? (
            <div
              className={[
                "pairingsPanel",
                phase === "between" || phase === "idle"
                  ? "pairingsPanelBetween"
                  : "",
              ]
                .filter(Boolean)
                .join(" ")}
            >
              <div className="pairingsTitle">Round {pairingRoundIndex + 1} pairings</div>
              <div className="pairingsList">
                {currentPairings.map((pairing, idx) => (
                  <div key={`${pairing.left}-${pairing.right ?? "idle"}-${idx}`} className="pairingChip">
                    {pairing.right == null
                      ? `${pairing.left} - idle`
                      : `${pairing.left} - ${pairing.right}`}
                  </div>
                ))}
              </div>
            </div>
          ) : null}

          {selectedSet == null ? (
            <>
              <div className="participantsSetup">
                <label className="participantsLabel" htmlFor="participants">
                  Participants
                </label>
                <textarea
                  id="participants"
                  className="participantsInput"
                  value={participantsInput}
                  onChange={(e) => setParticipantsInput(e.target.value)}
                  placeholder={"Alice\nBob\nCharlie\nDana"}
                />
              </div>

              <div className="chooserLayout">
                {QUESTION_SETS.map((set) => (
                  <button
                    key={set.id}
                    type="button"
                    className="setCard"
                    onClick={() => chooseQuestionSet(set.id)}
                  >
                    <span className="setCardLabel">{set.title}</span>
                    <div className="setCardQuestions">
                      {set.questions.map((question) => (
                        <div key={question.name} className="setCardQuestion">
                          <div className="setCardQuestionEn">{question.textEn}</div>
                          <div className="setCardQuestionRu">{question.textRu}</div>
                        </div>
                      ))}
                    </div>
                  </button>
                ))}
              </div>
            </>
          ) : phase === "running" && activeQuestion ? (
            <div className="runningLayout">
              <div className="questionText">
                <div className="questionTextEn">{activeQuestion.textEn}</div>
                <div className="questionTextRu">{activeQuestion.textRu}</div>
              </div>
              <div className="timerText">{formatSeconds(remainingSeconds)}</div>
            </div>
          ) : phase === "between" ? (
            <div className="betweenText">переходим к следующему раунду</div>
          ) : phase === "finished" ? (
            <div className="finishedText">вопросы закончились</div>
          ) : (
            <div className="idleText">{hasAnyEnabledUnused ? " " : "вопросы закончились"}</div>
          )}
        </div>
      </div>

      {selectedSet != null ? (
        <div className="footer">
          <div className="footerInner">
            <div className="footerRow footerRowTop">
              {questions.map((q, idx) => (
                <label
                  key={q.name}
                  className={[
                    "toggleLabel",
                    effectiveNextIndex === idx ? "selected" : "",
                  ]
                    .filter(Boolean)
                    .join(" ")}
                  onMouseEnter={() => setHoverPreview(`${q.textEn} / ${q.textRu}`)}
                  onMouseLeave={() => setHoverPreview("")}
                >
                  <input
                    className="tinyRadio"
                    type="radio"
                    name="nextQuestion"
                    checked={effectiveNextIndex === idx}
                    disabled={q.used}
                    onChange={() => setNextQuestionIndex(idx)}
                  />
                  <span
                    className={[
                      "toggleName",
                      q.used ? "used" : "",
                    ]
                      .filter(Boolean)
                      .join(" ")}
                  >
                    {q.name}
                  </span>
                </label>
              ))}
            </div>

            <div className="footerRow footerRowBottom">
              <div className="preview" title={hoverPreview || nextQuestionPreview}>
                {hoverPreview
                  ? hoverPreview
                  : nextQuestionPreview
                    ? `next round: ${nextQuestionPreview}`
                    : ""}
              </div>

              <div className="rightControls">
                <div className="buttons">
                  <button
                    type="button"
                    className="smallButton"
                    disabled={phase !== "running" || isPaused}
                    onClick={pauseTimer}
                    title="Pause timer"
                  >
                    Pause
                  </button>
                  <button
                    type="button"
                    className="smallButton"
                    disabled={phase !== "running" || !isPaused}
                    onClick={resumeTimer}
                    title="Resume timer"
                  >
                    Resume
                  </button>
                  <button
                    type="button"
                    className="smallButton"
                    disabled={phase !== "running"}
                    onClick={resetTimerToFull}
                    title="Reset timer to full length"
                  >
                    Reset
                  </button>
                  <button
                    type="button"
                    className="smallButton"
                    disabled={phase !== "running"}
                    onClick={stopRoundEarly}
                    title="Stop round early"
                  >
                    Stop
                  </button>
                  <button
                    type="button"
                    className="nextButton"
                    disabled={phase === "running" || !hasAnyEnabledUnused}
                    onClick={startNextRound}
                    title="Manual trigger"
                  >
                    {nextRoundLabel}
                  </button>
                  <button
                    type="button"
                    className="smallButton"
                    onClick={resetAll}
                    title="Reset all rounds"
                  >
                    Reset all
                  </button>
                </div>

                <input
                  className="secondsInput"
                  inputMode="numeric"
                  pattern="[0-9]*"
                  value={roundSeconds}
                  onChange={(e) => {
                    const next = clampInt(Number(e.target.value), 1, 60 * 60);
                    setRoundSeconds(next);
                  }}
                  title="Round length (seconds)"
                />
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
