
// (C) Copyright 2015 Moodle Pty Ltd.
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
//     http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.

import { Injectable } from '@angular/core';
import { CoreQuestionBehaviourHandler } from '@core/question/providers/behaviour-delegate';
import { CoreQuestionDelegate } from '@core/question/providers/delegate';
import { CoreQuestionProvider, CoreQuestionState } from '@core/question/providers/question';

/**
 * Check if a response is complete.
 *
 * @param question The question.
 * @param answers Object with the question answers (without prefix).
 * @return 1 if complete, 0 if not complete, -1 if cannot determine.
 */
export type isCompleteResponseFunction = (question: any, answers: any) => number;

/**
 * Check if two responses are the same.
 *
 * @param question Question.
 * @param prevAnswers Object with the previous question answers.
 * @param prevBasicAnswers Object with the previous basic" answers (without sequencecheck, certainty, ...).
 * @param newAnswers Object with the new question answers.
 * @param newBasicAnswers Object with the previous basic" answers (without sequencecheck, certainty, ...).
 * @return Whether they're the same.
 */
export type isSameResponseFunction = (question: any, prevAnswers: any, prevBasicAnswers: any, newAnswers: any,
        newBasicAnswers: any) => boolean;

/**
 * Handler to support manual graded question behaviour.
 */
@Injectable()
export class AddonQbehaviourManualGradedHandler implements CoreQuestionBehaviourHandler {
    name = 'AddonQbehaviourManualGraded';
    type = 'manualgraded';

    constructor(private questionDelegate: CoreQuestionDelegate, private questionProvider: CoreQuestionProvider) {
        // Nothing to do.
    }

    /**
     * Determine a question new state based on its answer(s).
     *
     * @param component Component the question belongs to.
     * @param attemptId Attempt ID the question belongs to.
     * @param question The question.
     * @param siteId Site ID. If not defined, current site.
     * @return New state (or promise resolved with state).
     */
    determineNewState(component: string, attemptId: number, question: any, siteId?: string)
            : CoreQuestionState | Promise<CoreQuestionState> {
        return this.determineNewStateManualGraded(component, attemptId, question, siteId);
    }

    /**
     * Determine a question new state based on its answer(s) for manual graded question behaviour.
     *
     * @param component Component the question belongs to.
     * @param attemptId Attempt ID the question belongs to.
     * @param question The question.
     * @param siteId Site ID. If not defined, current site.
     * @param isCompleteFn Function to override the default isCompleteResponse check.
     * @param isSameFn Function to override the default isSameResponse check.
     * @return Promise resolved with state.
     */
    determineNewStateManualGraded(component: string, attemptId: number, question: any, siteId?: string,
            isCompleteFn?: isCompleteResponseFunction, isSameFn?: isSameResponseFunction): Promise<CoreQuestionState> {

        // Check if we have local data for the question.
        return this.questionProvider.getQuestion(component, attemptId, question.slot, siteId).catch(() => {
            // No entry found, use the original data.
            return question;
        }).then((dbQuestion) => {
            const state = this.questionProvider.getState(dbQuestion.state);

            if (state.finished || !state.active) {
                // Question is finished, it cannot change.
                return state;
            }

            // We need to check if the answers have changed. Retrieve current stored answers.
            return this.questionProvider.getQuestionAnswers(component, attemptId, question.slot, false, siteId)
                    .then((prevAnswers) => {

                const newBasicAnswers = this.questionProvider.getBasicAnswers(question.answers);

                prevAnswers = this.questionProvider.convertAnswersArrayToObject(prevAnswers, true);
                const prevBasicAnswers = this.questionProvider.getBasicAnswers(prevAnswers);

                // If answers haven't changed the state is the same.
                if (isSameFn) {
                    if (isSameFn(question, prevAnswers, prevBasicAnswers, question.answers, newBasicAnswers)) {
                        return state;
                    }
                } else {
                    if (this.questionDelegate.isSameResponse(question, prevBasicAnswers, newBasicAnswers)) {
                        return state;
                    }
                }

                // Answers have changed. Now check if the response is complete and calculate the new state.
                let complete: number,
                    newState: string;
                if (isCompleteFn) {
                    // Pass all the answers since some behaviours might need the extra data.
                    complete = isCompleteFn(question, question.answers);
                } else {
                    // Only pass the basic answers since questions should be independent of extra data.
                    complete = this.questionDelegate.isCompleteResponse(question, newBasicAnswers);
                }

                if (complete < 0) {
                    newState = 'cannotdeterminestatus';
                } else if (complete > 0) {
                    newState = 'complete';
                } else {
                    newState = 'todo';
                }

                return this.questionProvider.getState(newState);
            });
        });
    }

    /**
     * Whether or not the handler is enabled on a site level.
     *
     * @return True or promise resolved with true if enabled.
     */
    isEnabled(): boolean | Promise<boolean> {
        return true;
    }
}
