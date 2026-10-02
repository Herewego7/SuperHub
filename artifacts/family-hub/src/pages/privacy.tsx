export default function PrivacyPolicy() {
  return (
    <div className="min-h-screen bg-white">
      <div className="max-w-3xl mx-auto px-6 py-16">
        <a href="/?openSettings=1" className="inline-block text-indigo-600 hover:underline text-sm mb-6">← Back to SuperHub</a>
        <h1 className="text-3xl font-bold text-gray-900 mb-2">Privacy Policy</h1>
        <p className="text-sm text-gray-500 mb-10">Last updated: September 2026</p>

        <section className="mb-8">
          <h2 className="text-xl font-semibold text-gray-800 mb-3">1. Information We Collect</h2>
          <p className="text-gray-600 leading-relaxed mb-3">
            SuperHub collects the following information to provide our service:
          </p>
          <ul className="list-disc pl-6 text-gray-600 space-y-2">
            <li><strong>Account information:</strong> Your name and email address provided when you sign in.</li>
            <li><strong>Family data:</strong> Profile names, colors, and avatars you create for family members.</li>
            <li><strong>Calendar data:</strong> Events, chores, and meals you create within the app. If you connect Google Calendar or Microsoft Outlook, we access your calendar events on your behalf to display them in the app.</li>
            <li><strong>Health reminders:</strong> If you use the health features, we store the reminders you create &mdash; the medication or appointment name, dose, schedule, who it is for, and whether each dose was acknowledged. This is health information, and it is treated as the most sensitive data in the app. We do not sell it, use it for advertising, or share it with anyone outside the providers listed in section 5.</li>
            <li><strong>Photos and uploads:</strong> Profile photos, celebration photos, wishlist and savings-goal images, and any photo you take to import a recipe or a grocery flyer. Photos are stored in our database and are reachable only through time-limited links tied to your account.</li>
            <li><strong>Location:</strong> If you set a location for the weather display, we store the city, state/province and its coordinates. This is typed in by you &mdash; the app does not read your device&rsquo;s GPS.</li>
            <li><strong>Device tokens:</strong> If you enable notifications, we store the push token your device or browser issues, so we can deliver them.</li>
            <li><strong>Subscription data:</strong> Whether your household has an active subscription or trial, and the transaction identifier Apple sends us. Payment is handled entirely by Apple &mdash; we never see or store your card details.</li>
            <li><strong>Usage data:</strong> Basic logs of API requests (method, path, response code) for debugging purposes. We do not log request bodies or personal content.</li>
            <li><strong>Error reports:</strong> When something goes wrong, we collect the error and the technical context around it (the screen it happened on, and the browser or device type) to fix it. These reports are not tagged with your identity.</li>
          </ul>
        </section>

        <section className="mb-8">
          <h2 className="text-xl font-semibold text-gray-800 mb-3">2. How We Use Your Information</h2>
          <ul className="list-disc pl-6 text-gray-600 space-y-2">
            <li>To operate and display the SuperHub application.</li>
            <li>To sync and display your Google Calendar or Outlook events (only with your explicit permission).</li>
            <li>To send notifications you have opted into (e.g. bedtime reminders, daily briefs, health reminders).</li>
            <li>To show the weather for the location you entered.</li>
            <li>To confirm whether your household&rsquo;s subscription or trial is active.</li>
            <li>To diagnose crashes and errors so we can fix them.</li>
            <li>We do <strong>not</strong> sell your data to third parties.</li>
            <li>We do <strong>not</strong> use your data for advertising.</li>
          </ul>
        </section>

        <section className="mb-8">
          <h2 className="text-xl font-semibold text-gray-800 mb-3">3. Google Calendar and Outlook Access</h2>
          <p className="text-gray-600 leading-relaxed mb-3">
            When you connect a Google or Microsoft account, SuperHub requests read and write access to your
            calendars. This access is used solely to display your events within the app and to create or update
            events on your behalf when you make changes. We store OAuth tokens securely in our database and
            use them only to fetch calendar data. You can disconnect your calendar at any time from the Settings screen.
          </p>
          <p className="text-gray-600 leading-relaxed">
            <strong>You choose which calendars sync.</strong> Right after connecting an account — and any time
            afterward from Settings — you can select exactly which of that account's calendars (e.g. work,
            personal, shared) should sync into SuperHub. Only the calendars you select are fetched; the rest
            are left alone.
          </p>
        </section>

        <section className="mb-8">
          <h2 className="text-xl font-semibold text-gray-800 mb-3">4. Health Information</h2>
          <p className="text-gray-600 leading-relaxed mb-3">
            Health reminders exist to help a family remember a dose, not to create a medical record. SuperHub
            is not a medical device, gives no medical advice, and must not be relied on as the only safeguard
            for a medication that matters. Reminders can be delayed or missed &mdash; by a device that is off or
            out of battery, by notification permissions being switched off, or by a network problem.
          </p>
          <p className="text-gray-600 leading-relaxed mb-3">
            <strong>Health notifications are deliberately vague.</strong> A reminder that reaches your lock
            screen says only &ldquo;Medication reminder &mdash; Tap to see the details.&rdquo; It never names the
            medication, the dose, or the person it is for, because a lock screen can be read without unlocking
            the device. The details are visible only inside the app, behind your device&rsquo;s own passcode.
          </p>
          <p className="text-gray-600 leading-relaxed">
            Health reminders are visible to everyone signed in to your household account. Deleting a reminder
            deletes it and its history; deleting your account deletes all of it.
          </p>
        </section>

        <section className="mb-8">
          <h2 className="text-xl font-semibold text-gray-800 mb-3">5. Service Providers</h2>
          <p className="text-gray-600 leading-relaxed mb-3">
            We use a small number of providers to run the app. Each receives only what that feature needs, and
            none of them are permitted to use your data for their own purposes:
          </p>
          <ul className="list-disc pl-6 text-gray-600 space-y-2">
            <li><strong>Hosting and database (Replit):</strong> stores everything described above.</li>
            <li><strong>Apple and Google push services:</strong> deliver notifications to your devices. The
              notification text is what they carry &mdash; which is why health notifications say nothing specific.</li>
            <li><strong>Google (Gemini AI):</strong> used only when you ask the app to read something for you
              &mdash; importing a recipe, scanning a grocery flyer, or importing events from a screenshot or
              pasted text. The image or text you supply is sent for that one request and the result is returned
              to you. Nothing else in your account is sent, and this never happens on its own.</li>
            <li><strong>Open-Meteo:</strong> receives the coordinates of the location you entered, to return the
              weather. No account information is sent.</li>
            <li><strong>Sentry:</strong> receives error reports and their technical context.</li>
            <li><strong>Resend:</strong> sends account emails such as password resets and family invitations.</li>
            <li><strong>Apple:</strong> handles subscription purchases and tells us whether one is active.</li>
          </ul>
        </section>

        <section className="mb-8">
          <h2 className="text-xl font-semibold text-gray-800 mb-3">6. Data Storage and Security</h2>
          <p className="text-gray-600 leading-relaxed">
            Your data is stored in a PostgreSQL database. OAuth tokens (Google, Outlook) are stored encrypted
            at rest. We use HTTPS for all data in transit. Access to production systems is restricted to
            authorized administrators.
          </p>
        </section>

        <section className="mb-8">
          <h2 className="text-xl font-semibold text-gray-800 mb-3">7. Data Retention and Deletion</h2>
          <p className="text-gray-600 leading-relaxed">
            You may delete your account at any time from the Settings screen. When you delete your account,
            all associated data — profiles, events, chores, meals, health reminders and their history, photos and
            uploads, calendar tokens, location, and push subscriptions —
            is permanently removed. This process completes within 30 days.
          </p>
        </section>

        <section className="mb-8">
          <h2 className="text-xl font-semibold text-gray-800 mb-3">8. Children&rsquo;s Privacy</h2>
          <p className="text-gray-600 leading-relaxed">
            SuperHub is designed for family use and may contain profiles for children. We do not knowingly
            collect personal information directly from children under 13. Profile data for children (name,
            initials, color, optional photo, optional birth year, and chore/star history) is entered and
            managed by a parent or guardian.
          </p>
          <p className="text-gray-600 leading-relaxed mt-3">
            In compliance with the Children's Online Privacy Protection Act (COPPA), when a parent or guardian
            marks a profile as belonging to a child under 13, the app requires them to affirm parental consent
            before any information is stored for that child. We record the date of consent. We do not use
            children's data for advertising and do not share it with third parties for their own purposes. A
            parent or guardian may review or delete a child's profile and all associated data at any time from
            Settings, or withdraw consent by deleting the profile.
          </p>
        </section>

        <section className="mb-8">
          <h2 className="text-xl font-semibold text-gray-800 mb-3">9. Your Rights</h2>
          <ul className="list-disc pl-6 text-gray-600 space-y-2">
            <li><strong>Access:</strong> You can view all your data within the app at any time.</li>
            <li><strong>Deletion:</strong> Delete your account from Settings to remove all data.</li>
            <li><strong>Portability:</strong> Contact us to request an export of your data.</li>
            <li><strong>Correction:</strong> Edit your profile and family data directly in the app.</li>
          </ul>
        </section>

        <section className="mb-8">
          <h2 className="text-xl font-semibold text-gray-800 mb-3">10. Contact</h2>
          <p className="text-gray-600 leading-relaxed">
            For privacy questions or data requests, contact us at:{" "}
            <a href="mailto:chadcgiles@gmail.com" className="text-indigo-600 underline">
              chadcgiles@gmail.com
            </a>
          </p>
        </section>

        <div className="border-t pt-6 mt-10">
          <a href="/?openSettings=1" className="text-indigo-600 hover:underline text-sm">← Back to SuperHub</a>
        </div>
      </div>
    </div>
  );
}
