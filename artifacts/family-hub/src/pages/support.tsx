export default function Support() {
  return (
    <div className="min-h-screen bg-white">
      <div className="max-w-3xl mx-auto px-6 py-16">
        <a href="/?openSettings=1" className="inline-block text-indigo-600 hover:underline text-sm mb-6">← Back to SuperHub</a>
        <h1 className="text-3xl font-bold text-gray-900 mb-2">Support</h1>
        <p className="text-sm text-gray-500 mb-10">SuperHub — Help &amp; Contact</p>

        <section className="mb-10">
          <h2 className="text-xl font-semibold text-gray-800 mb-3">Contact Us</h2>
          <p className="text-gray-600 leading-relaxed mb-4">
            Have a question, found a bug, or just want to say hello? We read every message
            and aim to respond within one business day.
          </p>
          <a
            href="mailto:chadcgiles@gmail.com?subject=SuperHub%20Support"
            className="inline-flex items-center gap-2 px-5 py-2.5 bg-orange-600 text-white rounded-lg font-medium hover:bg-orange-700 transition-colors"
          >
            Email Support
          </a>
        </section>

        <section className="mb-10">
          <h2 className="text-xl font-semibold text-gray-800 mb-3">Knowledge Base</h2>
          <p className="text-gray-600 leading-relaxed mb-4">
            Search our full help center for answers on chores &amp; stars, calendar sync, rewards, PINs,
            notifications, and more — most questions are answered there instantly.
          </p>
          <a
            href="/help"
            className="inline-flex items-center gap-2 px-5 py-2.5 bg-orange-600 text-white rounded-lg font-medium hover:bg-orange-700 transition-colors"
          >
            Browse the Knowledge Base
          </a>
        </section>

        <section className="mb-10">
          <h2 className="text-xl font-semibold text-gray-800 mb-3">Request Data Deletion</h2>
          <p className="text-gray-600 leading-relaxed">
            To request deletion of your account and all associated data, either use the{" "}
            <strong>Delete Account</strong> option inside the app (Settings → scroll to bottom) or email us
            at{" "}
            <a href="mailto:chadcgiles@gmail.com?subject=Family%20Hub%20Data%20Deletion%20Request" className="text-orange-600 hover:underline">
              chadcgiles@gmail.com
            </a>{" "}
            with the subject line <em>Data Deletion Request</em>. We will confirm deletion within 30 days.
          </p>
        </section>

        <div className="border-t pt-6 mt-2">
          <a href="/?openSettings=1" className="text-indigo-600 hover:underline text-sm">← Back to SuperHub</a>
        </div>

        <div className="border-t pt-8 flex flex-wrap gap-4 text-sm text-gray-400">
          <a href="/privacy" className="hover:text-gray-600 hover:underline">Privacy Policy</a>
          <a href="/terms" className="hover:text-gray-600 hover:underline">Terms of Service</a>
          <a href="mailto:chadcgiles@gmail.com" className="hover:text-gray-600 hover:underline">chadcgiles@gmail.com</a>
        </div>
      </div>
    </div>
  );
}
