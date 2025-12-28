import TimerBar from './TimerBar';
import { Question } from '../types';

interface Props {
  question: Question;
  questionStartTime: number | null;
}

export default function QuestionPrompt({ question, questionStartTime }: Props) {
  const timeLimit = (question.timeLimitSec || 15) * 1000;
  const endsAt = questionStartTime ? questionStartTime + timeLimit : null;

  return (
    <div className="question-block">
      <div className="badge">Категория: {question.categoryId}</div>
      <h2 style={{ marginTop: 10 }}>{question.text}</h2>
      {endsAt && questionStartTime && <TimerBar startsAt={questionStartTime} endsAt={endsAt} label="Ответьте на вопрос" />}
      <div className="small-muted" style={{ marginTop: 8 }}>
        Ответы скрыты до завершения таймера. Выбирайте варианты на контроллерах.
      </div>
    </div>
  );
}
