import { Question } from '../types';

interface Props {
  question: Question;
  answerStats: Record<string, number>;
  accent?: string;
}

export default function QuestionResults({ question, answerStats, accent }: Props) {
  const totalAnswers = Object.values(answerStats).reduce((a, b) => a + b, 0);
  return (
    <div className="answers-grid" style={{ marginTop: 12 }}>
      {question.options.map((opt) => {
        const count = answerStats[opt.id] || 0;
        const percent = totalAnswers ? Math.round((count / totalAnswers) * 100) : 0;
        const highlight = question.correctOptionId === opt.id;
        return (
          <div
            key={opt.id}
            className={`answer-tile ${highlight ? 'answer-tile--correct' : ''}`}
            style={{ ['--accent' as string]: accent || '#22c55e' }}
          >
            <div className="answer-tile__row">
              <div className="answer-tile__title">{opt.text}</div>
              <div className="answer-tile__percent">{percent}%</div>
            </div>
            <div className="answer-tile__bar">
              <div className="answer-tile__fill" style={{ width: `${percent}%` }} />
            </div>
            <div className="small-muted">{highlight ? 'Верный ответ' : `Выбрали: ${count}`}</div>
          </div>
        );
      })}
    </div>
  );
}
