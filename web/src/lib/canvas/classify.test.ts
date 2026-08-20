import { test } from 'vitest';
import assert from 'node:assert/strict';
import { classifyAssignment, classifyQuiz } from '@/lib/canvas/sync';
import type { CanvasAssignment, CanvasQuiz } from '@/lib/canvas/client';

function assignment(overrides: Partial<CanvasAssignment>): CanvasAssignment {
  return {
    id: 1,
    course_id: 1,
    name: 'Homework 1',
    description: null,
    due_at: null,
    unlock_at: null,
    lock_at: null,
    points_possible: 10,
    html_url: null,
    submission_types: ['online_upload'],
    ...overrides,
  };
}

test('exams are detected from the title, since Canvas has no exam type', () => {
  for (const name of ['Midterm 2', 'Final Exam', 'Prelim 1', 'Exam 3', 'Test 2']) {
    assert.equal(classifyAssignment(assignment({ name })), 'exam', name);
  }
});

test('quiz signals from Canvas are respected', () => {
  assert.equal(classifyAssignment(assignment({ name: 'Week 3 Check', quiz_id: 88 })), 'quiz');
  assert.equal(
    classifyAssignment(assignment({ name: 'Week 3 Check', submission_types: ['online_quiz'] })),
    'quiz',
  );
});

test('ordinary homework stays an assignment', () => {
  assert.equal(classifyAssignment(assignment({ name: 'Problem Set 4' })), 'assignment');
  assert.equal(
    classifyAssignment(assignment({ name: 'Reading response', submission_types: ['discussion_topic'] })),
    'discussion',
  );
});

test('"latest" does not trip the exam matcher', () => {
  // Word-boundary anchoring matters: substring matching would classify
  // "Contest" or "Latest reading" as an exam.
  assert.equal(classifyAssignment(assignment({ name: 'Latest reading log' })), 'assignment');
  assert.equal(classifyAssignment(assignment({ name: 'Protest essay' })), 'assignment');
});

test('quizzes classify by title and type', () => {
  const quiz = (overrides: Partial<CanvasQuiz>): CanvasQuiz => ({
    id: 1,
    title: 'Quiz 1',
    description: null,
    due_at: null,
    unlock_at: null,
    lock_at: null,
    points_possible: 10,
    html_url: null,
    quiz_type: 'assignment',
    assignment_id: null,
    ...overrides,
  });

  assert.equal(classifyQuiz(quiz({})), 'quiz');
  assert.equal(classifyQuiz(quiz({ title: 'Final Exam' })), 'exam');
  assert.equal(classifyQuiz(quiz({ title: 'Course feedback', quiz_type: 'survey' })), 'other');
});
