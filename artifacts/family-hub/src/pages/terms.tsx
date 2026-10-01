export default function TermsOfService() {
  return (
    <div className="min-h-screen bg-white">
      <div className="max-w-3xl mx-auto px-6 py-16">
        <a href="/?openSettings=1" className="inline-block text-indigo-600 hover:underline text-sm mb-6">← Back to Family Hub+</a>
        <h1 className="text-3xl font-bold text-gray-900 mb-2">Terms of Service</h1>
        <p className="text-sm text-gray-500 mb-10">Last updated: June 2026</p>

        <section className="mb-8">
          <h2 className="text-xl font-semibold text-gray-800 mb-3">1. Acceptance of Terms</h2>
          <p className="text-gray-600 leading-relaxed">
            By using Family Hub+, you agree to these Terms of Service. If you do not agree, please
            discontinue use of the application.
          </p>
        </section>

        <section className="mb-8">
          <h2 className="text-xl font-semibold text-gray-800 mb-3">2. Description of Service</h2>
          <p className="text-gray-600 leading-relaxed">
            Family Hub+ is a family organization application that helps families manage calendars, chores,
            meals, rewards, and other household activities. The service integrates with Google Calendar and
            Microsoft Outlook when you choose to connect those accounts.
          </p>
        </section>

        <section className="mb-8">
          <h2 className="text-xl font-semibold text-gray-800 mb-3">3. User Accounts</h2>
          <ul className="list-disc pl-6 text-gray-600 space-y-2">
            <li>You are responsible for maintaining the security of your account.</li>
            <li>You must provide accurate information when creating your account.</li>
            <li>You are responsible for all activity that occurs under your account.</li>
            <li>You must be 13 years of age or older to create an account. Parents may create profiles for younger children.</li>
          </ul>
        </section>

        <section className="mb-8">
          <h2 className="text-xl font-semibold text-gray-800 mb-3">4. Acceptable Use</h2>
          <p className="text-gray-600 leading-relaxed mb-3">You agree not to:</p>
          <ul className="list-disc pl-6 text-gray-600 space-y-2">
            <li>Use the service for any unlawful purpose.</li>
            <li>Attempt to gain unauthorized access to other users' accounts or data.</li>
            <li>Reverse engineer, decompile, or attempt to extract the source code of the application.</li>
            <li>Use the service in a way that could damage, disable, or impair our servers.</li>
          </ul>
        </section>

        <section className="mb-8">
          <h2 className="text-xl font-semibold text-gray-800 mb-3">5. Third-Party Integrations</h2>
          <p className="text-gray-600 leading-relaxed">
            Family Hub+ optionally integrates with Google Calendar and Microsoft Outlook. Your use of those
            services is governed by their respective terms and privacy policies. We are not responsible for
            the availability or accuracy of data provided by third-party calendar services.
          </p>
        </section>

        <section className="mb-8">
          <h2 className="text-xl font-semibold text-gray-800 mb-3">6. Data & Privacy</h2>
          <p className="text-gray-600 leading-relaxed">
            Your use of Family Hub+ is also governed by our{" "}
            <a href="/privacy" className="text-indigo-600 underline">Privacy Policy</a>, which is
            incorporated into these Terms by reference.
          </p>
        </section>

        <section className="mb-8">
          <h2 className="text-xl font-semibold text-gray-800 mb-3">7. Termination</h2>
          <p className="text-gray-600 leading-relaxed">
            You may stop using Family Hub+ at any time and delete your account from Settings. We reserve the
            right to suspend or terminate accounts that violate these Terms. Upon termination, your data will
            be deleted in accordance with our Privacy Policy.
          </p>
        </section>

        <section className="mb-8">
          <h2 className="text-xl font-semibold text-gray-800 mb-3">8. Disclaimer of Warranties</h2>
          <p className="text-gray-600 leading-relaxed">
            Family Hub+ is provided "as is" without warranties of any kind. We do not guarantee that the
            service will be uninterrupted, error-free, or that data will never be lost. We recommend
            maintaining independent records of important family information.
          </p>
        </section>

        <section className="mb-8">
          <h2 className="text-xl font-semibold text-gray-800 mb-3">9. Limitation of Liability</h2>
          <p className="text-gray-600 leading-relaxed">
            To the maximum extent permitted by law, Family Hub+ and its operators shall not be liable for
            any indirect, incidental, special, or consequential damages arising from your use of the service.
          </p>
        </section>

        <section className="mb-8">
          <h2 className="text-xl font-semibold text-gray-800 mb-3">10. Changes to Terms</h2>
          <p className="text-gray-600 leading-relaxed">
            We may update these Terms from time to time. Continued use of Family Hub+ after changes are
            posted constitutes acceptance of the updated Terms.
          </p>
        </section>

        <section className="mb-8">
          <h2 className="text-xl font-semibold text-gray-800 mb-3">11. Contact</h2>
          <p className="text-gray-600 leading-relaxed">
            Questions about these Terms?{" "}
            <a href="mailto:chadcgiles@gmail.com" className="text-indigo-600 underline">
              chadcgiles@gmail.com
            </a>
          </p>
        </section>

        <div className="border-t pt-6 mt-10">
          <a href="/?openSettings=1" className="text-indigo-600 hover:underline text-sm">← Back to Family Hub+</a>
        </div>
      </div>
    </div>
  );
}
