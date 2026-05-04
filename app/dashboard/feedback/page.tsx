'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { MessageSquareDiff } from "lucide-react";
import { supabase, signOutLocalOnRefreshFailure } from '@/lib/supabase';
import { resolveCurrentUserLabId } from '@/lib/inventory-utils';

type FeedbackType = 'bug' | 'support' | 'feedback';

const TYPE_OPTIONS: { value: FeedbackType; label: string; emoji: string }[] = [
  { value: 'bug', label: 'Bug Report', emoji: '⚠️' },
  { value: 'support', label: 'Support Request', emoji: '🙋' },
  { value: 'feedback', label: 'Feedback', emoji: '💬' },
];

const initialForm = {
  type: 'bug' as FeedbackType,
  title: '',
  description: '',
};

export default function FeedbackSupportPage() {
  const router = useRouter();
  const formRef = useRef<HTMLFormElement>(null);
  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');
  const [formData, setFormData] = useState(initialForm);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'Enter' || e.repeat) return;
      if (document.activeElement?.tagName === 'TEXTAREA') return;
      if (loading) return;
      const form = formRef.current;
      if (!form || !form.contains(document.activeElement)) return;
      e.preventDefault();
      form.requestSubmit();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [loading]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setSuccess(false);
    setErrorMessage('');

    try {
      const {
        data: { user },
        error: authError,
      } = await supabase.auth.getUser();

      if (authError) {
        if (await signOutLocalOnRefreshFailure(authError)) {
          throw new Error('Your session expired. Please sign in again.');
        }
        throw new Error(authError.message || 'You must be logged in to submit.');
      }
      if (!user) {
        throw new Error('You must be logged in to submit.');
      }

      const labId = await resolveCurrentUserLabId();
      if (!labId) {
        throw new Error(
          'No lab is associated with your account. Open the dashboard from a lab user profile, or contact an administrator.'
        );
      }

      const { error: insertError } = await supabase.from('feedback').insert({
        type: formData.type,
        title: formData.title.trim(),
        description: formData.description.trim(),
        lab_id: labId,
        user_id: user.id,
      });

      if (insertError) throw insertError;

      setFormData(initialForm);
      setSuccess(true);
    } catch (err: unknown) {
      console.error('Feedback submission error:', err);
      const message =
        err instanceof Error
          ? err.message
          : typeof err === 'object' &&
              err !== null &&
              'message' in err &&
              typeof (err as { message: unknown }).message === 'string'
            ? (err as { message: string }).message
            : 'Something went wrong. Please try again.';
      setErrorMessage(message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="max-w-3xl mx-auto py-8 px-4 sm:px-6">
      <div className="bg-white dark:bg-gray-900 shadow-sm border border-gray-200 dark:border-gray-800 rounded-xl overflow-hidden">
        <div className="bg-gray-50 dark:bg-gray-800/50 px-6 py-6 border-b border-gray-200 dark:border-gray-800">
          <h2 className="text-xl font-semibold text-gray-900 dark:text-white flex items-center gap-2">
            <MessageSquareDiff className="size-6 text-primary shrink-0" aria-hidden />
            Feedback &amp; Support
          </h2>
          <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
            Report bugs, ask for help, or share ideas. Your message is tied to your current lab and
            account.
          </p>
        </div>

        <div className="px-6 py-6">
          {success && (
            <div className="mb-6 p-4 rounded-md bg-green-50 dark:bg-green-900/30 border border-green-200 dark:border-green-800 flex items-start gap-3">
              <svg
                className="w-5 h-5 text-green-600 dark:text-green-400 mt-0.5 shrink-0"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth="2"
                  d="M5 13l4 4L19 7"
                />
              </svg>
              <div>
                <h3 className="text-sm font-medium text-green-800 dark:text-green-300">
                  Thanks — we received your submission
                </h3>
                <p className="text-sm text-green-700 dark:text-green-400 mt-1">
                  We will review it and follow up as needed. You can submit another message below.
                </p>
              </div>
            </div>
          )}

          {errorMessage && (
            <div className="mb-6 p-4 rounded-md bg-red-50 dark:bg-red-900/30 border border-red-200 dark:border-red-800 flex items-start gap-3">
              <svg
                className="w-5 h-5 text-red-600 dark:text-red-400 mt-0.5 shrink-0"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth="2"
                  d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
                />
              </svg>
              <div>
                <h3 className="text-sm font-medium text-red-800 dark:text-red-300">
                  Submission failed
                </h3>
                <p className="text-sm text-red-700 dark:text-red-400 mt-1">{errorMessage}</p>
              </div>
            </div>
          )}

          <form ref={formRef} onSubmit={handleSubmit} className="space-y-5">
            <div>
              <span className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                Type
              </span>
              <div className="flex flex-col sm:flex-row gap-2">
                {TYPE_OPTIONS.map((opt) => {
                  const selected = formData.type === opt.value;
                  return (
                    <button
                      key={opt.value}
                      type="button"
                      onClick={() => setFormData((prev) => ({ ...prev, type: opt.value }))}
                      className={[
                        'flex-1 inline-flex items-center justify-center gap-2 rounded-lg border px-3 py-2.5 text-sm font-medium transition-colors',
                        selected
                          ? 'border-blue-500 bg-blue-50 dark:bg-blue-950/40 text-blue-900 dark:text-blue-100 ring-1 ring-blue-500/60'
                          : 'border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800/80 text-gray-700 dark:text-gray-300 hover:border-gray-400 dark:hover:border-gray-600 hover:bg-gray-50 dark:hover:bg-gray-800',
                      ].join(' ')}
                    >
                      <span aria-hidden>{opt.emoji}</span>
                      {opt.label}
                    </button>
                  );
                })}
              </div>
            </div>

            <div>
              <label
                htmlFor="feedback-title"
                className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1"
              >
                Title <span className="text-red-500">*</span>
              </label>
              <input
                id="feedback-title"
                type="text"
                required
                placeholder="Short summary"
                className="block w-full rounded-md border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 px-3 py-2 text-gray-900 dark:text-white placeholder-gray-400 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 text-sm"
                value={formData.title}
                onChange={(e) => setFormData((prev) => ({ ...prev, title: e.target.value }))}
              />
            </div>

            <div>
              <label
                htmlFor="feedback-description"
                className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1"
              >
                Description <span className="text-red-500">*</span>
              </label>
              <textarea
                id="feedback-description"
                required
                rows={6}
                placeholder="Steps to reproduce, what you need, or your suggestion…"
                className="block w-full rounded-md border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 px-3 py-2 text-gray-900 dark:text-white placeholder-gray-400 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 text-sm"
                value={formData.description}
                onChange={(e) =>
                  setFormData((prev) => ({ ...prev, description: e.target.value }))
                }
              />
            </div>

            <div className="pt-4 flex justify-end gap-3 border-t border-gray-100 dark:border-gray-800 mt-6">
              <button
                type="button"
                onClick={() => router.push('/dashboard')}
                className="inline-flex items-center justify-center rounded-md px-4 py-2 text-sm font-medium text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={loading}
                className="inline-flex items-center justify-center rounded-md bg-blue-600 px-6 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-blue-500 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                {loading ? (
                  <>
                    <svg
                      className="animate-spin -ml-1 mr-2 h-4 w-4 text-white"
                      fill="none"
                      viewBox="0 0 24 24"
                      aria-hidden
                    >
                      <circle
                        className="opacity-25"
                        cx="12"
                        cy="12"
                        r="10"
                        stroke="currentColor"
                        strokeWidth="4"
                      />
                      <path
                        className="opacity-75"
                        fill="currentColor"
                        d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
                      />
                    </svg>
                    Submitting…
                  </>
                ) : (
                  'Submit'
                )}
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
}
