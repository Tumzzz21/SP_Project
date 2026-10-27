'use strict';

/** Shared learning taxonomy used by the database, routes, and templates. */
const CATEGORIES = [
  {
    key: 'phishing',
    label: 'Phishing awareness',
    short: 'Phishing',
    description: 'Spot fake emails, texts, and login pages before they steal your credentials.',
  },
  {
    key: 'passwords',
    label: 'Password security',
    short: 'Passwords',
    description: 'Build strong, unique passwords and use multi-factor authentication well.',
  },
  {
    key: 'scams',
    label: 'Online scams',
    short: 'Scams',
    description: 'Recognise marketplace, job, scholarship, and romance scams targeting students.',
  },
  {
    key: 'privacy',
    label: 'Data privacy',
    short: 'Privacy',
    description: 'Protect personal information and understand what apps really collect.',
  },
  {
    key: 'ethics',
    label: 'Responsible internet use',
    short: 'Ethics',
    description: 'Practise ethical, lawful, and respectful behaviour online.',
  },
];

const CATEGORY_KEYS = CATEGORIES.map((category) => category.key);

/** @param {string} key */
function categoryByKey(key) {
  return CATEGORIES.find((category) => category.key === key) || null;
}

module.exports = {
  CATEGORIES,
  CATEGORY_KEYS,
  categoryByKey,
  TOPIC_COUNT: CATEGORIES.length,
};
