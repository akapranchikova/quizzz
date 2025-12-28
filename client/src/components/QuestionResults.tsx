import { Question } from '../types';

interface Props {
  question: Question;
  answerStats: Record<string, number>;
}

export default function QuestionResults({ question, answerStats }: Props) {
  const totalAnswers = Object.values(answerStats).reduce((a, b) => a + b, 0);
  return (
    <div className="answers-grid" style={{ marginTop: 12 }}>
      {question.options.map((opt) => {
        const count = answerStats[opt.id] || 0;
        const percent = totalAnswers ? Math.round((count / totalAnswers) * 100) : 0;
        const highlight = question.correctOptionId === opt.id;
        return (
          <div key={opt.id} className="answer-tile" style={{ borderColor: highlight ? '#22c55e' : undefined }}>
            <div style={{ fontWeight: 700 }}>{opt.text}</div>
            <div className="small-muted">
              {highlight ? 'Верно • ' : ''}
              Выбрали: {count} ({percent}%)
            </div>
          </div>
        );
      })}
    </div>
  );
}
