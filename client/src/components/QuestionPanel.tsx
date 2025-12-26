import { useEffect, useMemo, useState } from 'react';
import { Question } from '../types';

interface Props {
  question: Question;
  phase: 'question' | 'reveal';
  questionStartTime: number | null;
  answerStats?: Record<string, number>;
}

export default function QuestionPanel({ question, phase, questionStartTime, answerStats = {} }: Props) {
  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    if (!questionStartTime || phase !== 'question') return;
    const id = setInterval(() => setNow(Date.now()), 300);
    return () => clearInterval(id);
  }, [questionStartTime, phase]);

  const timeLimit = question.timeLimitSec || 15;
  const elapsed = questionStartTime ? (now - questionStartTime) / 1000 : 0;
  const remaining = Math.max(0, timeLimit - elapsed);
  const progress = Math.max(0, Math.min(1, remaining / timeLimit));

  const totalAnswers = useMemo(() => Object.values(answerStats).reduce((a, b) => a + b, 0), [answerStats]);

  return (
    <div className="question-block">
      <div className="badge">Категория: {question.categoryId}</div>
      <h2 style={{ marginTop: 10 }}>{question.text}</h2>
      {phase === 'question' && (
        <div className="timer-bar" aria-label="timer">
          <div className="timer-inner" style={{ width: `${progress * 100}%` }} />
          <div className="small-muted" style={{ marginTop: 6 }}>
            Осталось {Math.ceil(remaining)} сек
          </div>
        </div>
      )}
      <div className="answers-grid" style={{ marginTop: 12 }}>
        {question.options.map((opt) => {
          const count = answerStats[opt.id] || 0;
          const percent = totalAnswers ? Math.round((count / totalAnswers) * 100) : 0;
          const highlight = phase === 'reveal' && question.correctOptionId === opt.id;
          return (
            <div key={opt.id} className="answer-tile" style={{ borderColor: highlight ? '#22c55e' : undefined }}>
              <div style={{ fontWeight: 700 }}>{opt.text}</div>
              {phase === 'reveal' && (
                <div className="small-muted">
                  {highlight ? 'Верно • ' : ''}
                  Выбрали: {count} ({percent}%)
                </div>
              )}
              {phase === 'question' && totalAnswers > 0 && <div className="small-muted">Ответов: {count}</div>}
            </div>
          );
        })}
      </div>
      {phase === 'reveal' && question.explanation && (
        <div className="alert" style={{ marginTop: 12 }}>{question.explanation}</div>
      )}
    </div>
  );
}
