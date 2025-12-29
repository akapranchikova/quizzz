import TimerBar from './TimerBar';
import { Question } from '../types';

interface Props {
  question: Question;
  questionStartTime: number | null;
  accent?: string;
}

export default function QuestionPrompt({ question, questionStartTime, accent }: Props) {
  const timeLimit = (question.timeLimitSec || 15) * 1000;
  const endsAt = questionStartTime ? questionStartTime + timeLimit : null;

  return (
    <div className="question-block">
      <div className="question-text">{question.text}</div>
      {endsAt && questionStartTime && (
        <TimerBar startsAt={questionStartTime} endsAt={endsAt} showTimeText={false} accent={accent} />
      )}
    </div>
  );
}
