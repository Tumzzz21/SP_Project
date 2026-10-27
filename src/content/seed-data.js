'use strict';

/**
 * Seed content for local development.
 *
 * The lessons are short, accurate explanations of the five learning goals.
 * They are intentionally plain text (see content/render.js) and are inserted
 * as `published` so the Learning Center is never an empty shell.
 */

const LESSONS = [
  {
    slug: 'spotting-phishing-messages',
    title: 'Spotting phishing messages before they cost you',
    category: 'phishing',
    readingMinutes: 6,
    summary:
      'Phishing is a fake message designed to make you hand over a password, a code, or money. Learn the four signals that give most attacks away.',
    content: `## What phishing actually is
Phishing is social engineering: the attacker imitates a person or service you already trust, then creates urgency so you act before you think. The goal is usually a password, a one-time code, a payment, or permission to install something.

Most student phishing arrives by email, text message, or a direct message on social media. It often imitates the school portal, a bank, a delivery company, or a group chat.

## The four signals worth checking first
- **Urgency plus a threat.** "Your account will be closed in 24 hours" is designed to stop you from verifying anything.
- **A link that does not match the organisation.** Hover or long-press to read the real domain. Attackers use lookalikes such as "sch00l-portal.com" or extra words before the real domain.
- **A request for credentials or a code.** No legitimate school, bank, or platform asks for your password or the six-digit code sent to your phone.
- **An unexpected attachment.** Invoices, "receipts", and shared documents are common carriers for malware.

## Check the sender, not just the display name
The display name is free text. Expand the address and read the domain after the @ symbol. A message from "Registrar Office" that actually comes from a Gmail address is not from your registrar.

> Treat every unexpected login page as hostile until you reached it yourself by typing the address or using a saved bookmark.

## What to do when you suspect phishing
- Do not click, reply, or forward the message to classmates.
- Report it through your school's IT channel, then delete it.
- If you already entered a password, change it immediately, sign out other sessions, and turn on multi-factor authentication.
- If you sent money, contact your bank at once; early reports are sometimes recoverable.

## Why "just be careful" is not enough
Attackers only need one success out of hundreds of attempts. Build a habit instead of relying on suspicion: type addresses yourself, use a password manager that fills only the correct domain, and confirm unusual requests through a second channel such as a phone call to a known number.`,
  },
  {
    slug: 'strong-passwords-and-mfa',
    title: 'Strong passwords, passphrases, and multi-factor authentication',
    category: 'passwords',
    readingMinutes: 6,
    summary:
      'Length beats complexity, reuse is the real risk, and one extra factor blocks most account takeovers. A practical routine you can set up in an afternoon.',
    content: `## Why reuse is the biggest problem
When one website is breached, attackers take the leaked email and password pairs and try them on other services. This is called credential stuffing, and it works because most people reuse passwords. A password that is strong but reused is still a single point of failure for every account that shares it.

## Length beats symbol soup
Modern guidance favours long passphrases over short passwords with forced symbols. Four or five unrelated words, or a randomly generated password of 16 or more characters, resists guessing and cracking far better than "P@ssw0rd!".

- Use a different password for every account.
- Let a password manager generate and remember them for you.
- Protect the manager itself with a long passphrase and multi-factor authentication.
- Never store passwords in a spreadsheet, a notes app, or a chat message to yourself.

## Turn on multi-factor authentication
Multi-factor authentication (MFA) asks for a second proof, such as an app code or a hardware key. Even a stolen password is then not enough on its own.

- Prefer an authenticator app or a passkey over SMS codes, because SMS can be intercepted or stolen through SIM swapping.
- Never approve a sign-in prompt you did not start. Repeated prompts mean someone already has your password.
- Save recovery codes somewhere offline and private.

> If a service offers passkeys, use them. Passkeys are bound to the real website domain, so a phishing page cannot capture them the way it captures a typed password.

## A routine that actually holds up
1. Pick a password manager and create one long master passphrase.
2. Change the passwords of your most important accounts first: school email, personal email, banking, and social accounts.
3. Enable MFA everywhere it is offered, starting with email, since email can reset everything else.
4. When you sign out of a shared computer, also sign out of the browser profile and clear saved passwords on that machine.

## What to do after a breach notice
Change the password on the affected service, change it anywhere it was reused, sign out all sessions, check recovery email addresses and phone numbers, and review recent account activity. Do this quickly; the first hours matter most.`,
  },
  {
    slug: 'scams-that-target-students',
    title: 'Scams that target students: money, jobs, and rentals',
    category: 'scams',
    readingMinutes: 7,
    summary:
      'Fake job offers, unpaid internships, scholarship fees, marketplace deposits, and romance scams follow predictable scripts. Learn the patterns and exit early.',
    content: `## The common thread: pay or act before you can verify
Almost every scam asks you to send money, share a code, or accept a "deal" that disappears if you slow down. Legitimate organisations do not lose interest because you asked for written terms.

## Job and internship scams
- **Upfront payment.** A real employer never asks you to pay for training, equipment, or a background check before you start.
- **Off-platform contact only.** Interviews that happen entirely in a chat app, with no company domain email, are a warning sign.
- **Cheque or overpayment tricks.** You receive a cheque or transfer for more than agreed, then are asked to send back the difference. The original payment is later reversed and your money is gone.
- **Task and "commission" jobs.** Small payouts build trust, then a larger deposit is requested. This is a classic advance-fee scheme.

## Marketplace and rental scams
Deposits requested before you see a room, listings copied from other sites, and sellers who insist on payment outside the platform's protected checkout are all common. Meet in a public place, inspect first, and keep the payment inside the platform when one exists.

## Scholarship and financial-aid scams
Real scholarships do not charge an application fee, and no legitimate aid office asks for your password or a one-time code. Search for the scholarship on your school's official financial-aid page before you send any document.

> If someone asks you to keep the transaction secret, or says the offer is only valid for the next ten minutes, treat it as a scam until proven otherwise.

## Romance and friendship scams
Long, patient conversations that eventually lead to a request for money, gift cards, or crypto are a well-documented pattern. Reverse-image search the photos, refuse to send money, and never act as a "money mule" by receiving and forwarding transfers for someone else; that can make you legally responsible.

## How to check before you commit
- Search the company or person's name together with the word "scam".
- Verify the employer through the official careers page, not the link in the message.
- Ask for a contract and a call with a named person on a company number.
- Tell a friend or family member the details. Scams rely on isolation.

## If you have already paid
Contact your bank immediately and ask about a recall or chargeback. Report the account to the platform, keep screenshots and receipts, and change any passwords you shared. Losing money is not a reason to hide what happened; fast reporting is the best chance of recovery.`,
  },
  {
    slug: 'your-personal-data-footprint',
    title: 'Your personal data footprint, and how to shrink it',
    category: 'privacy',
    readingMinutes: 6,
    summary:
      'What apps collect, why "free" services still cost something, how to audit permissions, and how to respond when your data appears where it should not.',
    content: `## What counts as personal data
Personal data is any information that can identify you or be linked to you: full name, student number, address, phone number, email, photos, location history, device identifiers, and even behavioural patterns such as when you are usually online.

Combined data is more revealing than any single item. A birth date, a school, and a photo of a street corner can be enough to locate a person.

## Why free apps still cost something
Many free services are funded by advertising, which relies on detailed profiles. That does not make every service malicious, but it does mean you should know what you are trading and limit it deliberately.

- Check the privacy settings of each new app before you use it, not after.
- Turn off precise location unless the feature genuinely needs it.
- Review which third-party apps have access to your Google or social account and revoke the ones you no longer use.
- Use a separate, less important email address for signups and newsletters.

## Practise data minimisation
Give the minimum information a service actually needs. A quiz app does not need your home address, and a discount code does not need your real birth date.

> Before posting a photo, check the background: ID cards, screens, address labels, and class schedules leak more than the subject of the photo.

## Secure the accounts that hold your data
Email is the master key to almost everything else. Protect it with a unique password and multi-factor authentication, keep recovery details current, and remove old devices from the account's active sessions list.

## Know your rights and your school's rules
Many countries give people the right to access, correct, and delete their personal data. In the Philippines, the Data Privacy Act of 2012 (Republic Act 10173) sets out these rights and requires organisations to protect personal information. Your school's data privacy office can help if your records are exposed.

## If your data is exposed
Change the password of the affected account, watch for targeted phishing that uses the leaked details, enable MFA everywhere, and report the incident to the organisation that lost the data. Do not pay anyone who claims they can delete leaked files; that is a second scam.`,
  },
  {
    slug: 'responsible-and-ethical-internet-use',
    title: 'Responsible and ethical internet use',
    category: 'ethics',
    readingMinutes: 5,
    summary:
      'Ethics online is not only about hacking. It covers consent, honesty, respect, copyright, and the legal lines that students cross without realising.',
    content: `## The same standards apply online
Being behind a screen does not change what counts as honest, respectful, or harmful. Before posting, ask three questions: is it true, is it kind, and would the person involved be comfortable seeing it?

## Consent and privacy of others
Sharing someone's photo, chat screenshot, or personal story without permission is a privacy harm even when the information is technically public. Group chats are not private; anything screenshotted can be forwarded.

- Do not repost someone's location, schedule, or contact details.
- Blur faces and identifying details when sharing screenshots.
- Ask before recording a call or a class session, and follow your school's policy.

## Cyberbullying and bystander responsibility
Harassment is not less serious because it happens in a chat. If you witness it, do not amplify it: report it through the platform and to a teacher or counsellor, and check on the person targeted. Saving evidence is fine; spreading it is not.

## Copyright and academic honesty
Software, images, music, and textbooks are protected works. Using them without a licence, or presenting someone else's work as your own, is both an academic offence and often a legal one. Cite sources properly, use openly licensed material where possible, and respect the terms of the tools you use.

## The legal lines students cross without noticing
- Accessing an account or device you were not given permission to use, even "just to look".
- Using someone else's login, or sharing your own credentials, which breaks most acceptable-use policies.
- Installing cracked software, which frequently carries malware.
- Scanning or attacking a network without written authorisation. Curiosity is not consent.

> Learning security skills is legitimate and valuable. Practise only on systems you own or on platforms that explicitly invite testing, such as legal capture-the-flag labs.

## Be a good digital citizen
Report harmful content, credit other people's work, keep disagreement civil, and protect the people around you by not forwarding unverified claims. Responsible internet use is a skill you practise, not a rule you memorise once.`,
  },
];

const QUIZZES = [
  {
    slug: 'phishing-basics',
    version: 1,
    title: 'Phishing basics check',
    description:
      'Four quick questions on recognising phishing messages. This quiz is used to validate the assessment foundation.',
    status: 'published',
    passingScorePercent: 75,
    questions: [
      {
        position: 1,
        prompt: 'An email says your school account will be closed in 24 hours unless you sign in through a link. What is the safest first step?',
        explanation:
          'Urgency plus a login link is the core phishing pattern. Open the portal yourself instead of using the link, then verify the warning through an official channel.',
        options: [
          { position: 1, label: 'Open the school portal by typing its address yourself and check for the warning', correct: true },
          { position: 2, label: 'Click the link quickly so the account is not closed', correct: false },
          { position: 3, label: 'Reply to the email asking whether it is genuine', correct: false },
          { position: 4, label: 'Forward it to classmates so they can decide', correct: false },
        ],
      },
      {
        position: 2,
        prompt: 'Which detail is the strongest sign that a message is not from your bank?',
        explanation:
          'The domain after the @ symbol is controlled by the real sender. Display names and logos are easy to copy, so the sending domain is the reliable signal.',
        options: [
          { position: 1, label: 'The bank logo looks slightly stretched', correct: false },
          { position: 2, label: 'The reply address is a free webmail account, not the bank domain', correct: true },
          { position: 3, label: 'The message was received at night', correct: false },
          { position: 4, label: 'The greeting uses your first name', correct: false },
        ],
      },
      {
        position: 3,
        prompt: 'You entered your password on a page you now believe was fake. What should you do first?',
        explanation:
          'Change the password immediately and sign out other sessions, then enable multi-factor authentication. Reporting and checking for reuse come next.',
        options: [
          { position: 1, label: 'Wait to see whether anything unusual happens', correct: false },
          { position: 2, label: 'Change the password now and sign out all other sessions', correct: true },
          { position: 3, label: 'Delete the browser history', correct: false },
          { position: 4, label: 'Email the site asking them to remove your data', correct: false },
        ],
      },
      {
        position: 4,
        prompt: 'Why does multi-factor authentication reduce the damage of a phishing attack?',
        explanation:
          'A stolen password alone is not enough when a second factor is required, and app-based codes or passkeys are much harder for an attacker to use remotely.',
        options: [
          { position: 1, label: 'It encrypts your password in the browser', correct: false },
          { position: 2, label: 'It makes passwords unnecessary', correct: false },
          { position: 3, label: 'A stolen password is no longer enough to sign in', correct: true },
          { position: 4, label: 'It blocks all phishing emails automatically', correct: false },
        ],
      },
    ],
  },
  {
    slug: 'password-hygiene',
    version: 1,
    title: 'Password hygiene review',
    description: 'Draft quiz reserved for the assessment phase. Not visible to students yet.',
    status: 'draft',
    passingScorePercent: 70,
    questions: [
      {
        position: 1,
        prompt: 'Which password is most resistant to guessing?',
        explanation: 'Length and randomness matter more than a predictable word with symbols added.',
        options: [
          { position: 1, label: 'Summer2024!', correct: false },
          { position: 2, label: 'a 16-character randomly generated password from a manager', correct: true },
          { position: 3, label: 'your student number plus your initials', correct: false },
          { position: 4, label: 'P@ssw0rd123', correct: false },
        ],
      },
    ],
  },
];

module.exports = { LESSONS, QUIZZES };
