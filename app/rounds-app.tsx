"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import rawQuestions from "./questions.json";

type QuestionSource = {
  name: string;
  question?: string;
};

type Question = {
  name: string;
  text: string;
  used: boolean;
};

type Phase = "idle" | "running" | "between" | "finished";

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
      text:
        typeof q.question === "string" && q.question.trim().length > 0
          ? q.question.trim()
          : q.name.trim(),
      used: false,
    }));
}

export default function RoundsApp() {
  const [questions, setQuestions] = useState<Question[]>(
    normalizeQuestions(rawQuestions),
  );
  const [phase, setPhase] = useState<Phase>("idle");
  const [roundSeconds, setRoundSeconds] = useState<number>(90);
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

  const activeQuestionText = useMemo(() => {
    if (activeQuestionIndex == null) return null;
    const q = questions[activeQuestionIndex];
    return q ? q.text : null;
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

  const nextQuestionText = useMemo(() => {
    if (effectiveNextIndex == null) return "";
    const q = questions[effectiveNextIndex];
    return q ? q.text : "";
  }, [effectiveNextIndex, questions]);

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
    setPhase("idle");
    setQuestions((prev) => prev.map((q) => ({ ...q, used: false })));
  }

  function startNextRound() {
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
        {phase === "running" && activeQuestionText ? (
          <div className="runningLayout">
            <div className="questionText">{activeQuestionText}</div>
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
                onMouseEnter={() => setHoverPreview(q.text)}
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
            <div className="preview" title={hoverPreview || nextQuestionText}>
              {hoverPreview
                ? hoverPreview
                : nextQuestionText
                  ? `next round: ${nextQuestionText}`
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
    </div>
  );
}
