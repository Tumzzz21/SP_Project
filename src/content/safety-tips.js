'use strict';

/**
 * Curated, always-available online-safety advice.
 *
 * Deliberately static: the Safety tips page must work before anyone signs in
 * (it is linked from the sign-in screen) and on a fresh install with no seeded
 * lessons, so it never touches the database.
 *
 * `icon` values must exist in src/views/partials/icon.ejs.
 */
const SAFETY_TIPS = [
  {
    id: 'phishing',
    icon: 'phishing',
    title: 'Spot phishing before you click',
    summary: 'Most account takeovers start with a message that wants you to act fast.',
    tips: [
      'Treat urgency, threats, and "act now" deadlines as the warning sign, not the reason to hurry.',
      'Check the real destination: hover a link on desktop, long-press it on a phone.',
      'Open banks, school portals, and social accounts from your own bookmark or the address bar.',
      'Never enter a password on a page you reached from an email, DM, or text message.',
    ],
  },
  {
    id: 'passwords',
    icon: 'passwords',
    title: 'Passwords that actually hold',
    summary: 'Length beats complexity, and reuse is what turns one leak into many.',
    tips: [
      'Use a long passphrase you can remember, at least four unrelated words.',
      'Give every important account its own password — never reuse the same one.',
      'Turn on two-factor authentication, and prefer an authenticator app or passkey over SMS.',
      'Store passwords in a password manager instead of a notes app or a spreadsheet.',
      'If a service you use reports a breach, change that password today and anywhere it was reused.',
    ],
  },
  {
    id: 'scams',
    icon: 'scams',
    title: 'Scams aimed at students',
    summary: 'Fake jobs, rentals, scholarships, and "friend in trouble" messages are the usual plays.',
    tips: [
      'Be suspicious of any offer that asks you to pay or share details before you get anything.',
      'Verify a person through a second channel before sending money or documents.',
      'Know that real institutions never ask for your password, PIN, or one-time codes.',
      'Slow down on marketplace and rental deals: photos, pressure, and off-platform payment are red flags.',
    ],
  },
  {
    id: 'privacy',
    icon: 'privacy',
    title: 'Keep your personal data yours',
    summary: 'Every permission, post, and form shares a little more than you think.',
    tips: [
      'Review app permissions and deny anything the app does not need to work.',
      'Check what a post reveals: location, school, timetable, or ID numbers in the background.',
      'Share your student ID, address, or birthday only with organisations that require them.',
      'Assume anything you upload can become public, even on "private" accounts.',
    ],
  },
  {
    id: 'browsing',
    icon: 'shield',
    title: 'Browsing and public Wi-Fi',
    summary: 'A few habits neutralise most network and device risks.',
    tips: [
      'Keep your browser and operating system updated — most attacks rely on old versions.',
      'On public Wi-Fi, avoid banking and shopping, or use your mobile data for those.',
      'Look for HTTPS before typing anything personal, and never ignore a certificate warning.',
      'Lock your screen whenever you leave your laptop or phone, even for a minute.',
      'Download software from official stores and vendor sites, never from ad links.',
    ],
  },
  {
    id: 'report',
    icon: 'target',
    title: 'If something goes wrong',
    summary: 'Fast, calm action limits the damage.',
    tips: [
      'Change the affected password immediately, then change it anywhere it was reused.',
      'Turn on two-factor authentication if it was off, and sign out other devices.',
      'Tell your instructor, IT helpdesk, or the platform it happened on — do not stay silent.',
      'Report scams to the platform and, in the Philippines, to the DICT or PNP-ACG.',
      'Keep the evidence: screenshots, sender addresses, and transaction references.',
    ],
  },
];

module.exports = { SAFETY_TIPS };
