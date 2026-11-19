import { prisma } from "./db";

export type ProfileFieldDef = {
  key: string;
  label: string;
  group: "Personal" | "Links" | "Education" | "Work" | "Preferences & logistics";
  type?: "text" | "textarea" | "date" | "number";
  placeholder?: string;
  /** Regexes matched (case-insensitive) against a form field's label for autofill. Order of defs matters: first match wins. */
  patterns?: RegExp[];
};

// Ordered from most specific to least specific so that e.g. "last name" wins over "name".
export const PROFILE_FIELDS: ProfileFieldDef[] = [
  { key: "firstName", label: "First name", group: "Personal", patterns: [/\bfirst\s*name\b/, /\bgiven\s*name\b/, /\bfname\b/] },
  { key: "middleName", label: "Middle name", group: "Personal", patterns: [/\bmiddle\s*name\b/] },
  { key: "lastName", label: "Last name", group: "Personal", patterns: [/\blast\s*name\b/, /\bsurname\b/, /\bfamily\s*name\b/, /\blname\b/] },
  { key: "fullName", label: "Full name", group: "Personal", patterns: [/^\s*(your\s+|full\s+|candidate'?s?\s+|applicant'?s?\s+)?name\s*\*?\s*$/, /\bfull\s*name\b/, /\bname\s+of\s+(the\s+)?(candidate|applicant)\b/, /\bname\s*\(as per/] },
  { key: "email", label: "Email", group: "Personal", patterns: [/\be-?mail\b/] },
  { key: "phone", label: "Phone (with country code)", group: "Personal", placeholder: "+91 98765 43210", patterns: [/\b(phone|mobile|contact\s*(no|number)|whatsapp|cell)\b/] },
  { key: "dateOfBirth", label: "Date of birth", group: "Personal", type: "date", patterns: [/\b(date\s*of\s*birth|dob|birth\s*date)\b/] },
  { key: "gender", label: "Gender", group: "Personal", placeholder: "Male / Female / Prefer not to say", patterns: [/\bgender\b|\bsex\b/] },
  { key: "currentCity", label: "Current city", group: "Personal", patterns: [/\bcurrent\s*(city|location)\b/, /^\s*city\b/, /\bwhere are you (currently )?(based|located)\b/, /^\s*location\s*\*?\s*$/] },
  { key: "state", label: "State", group: "Personal", patterns: [/^\s*state\b/, /\bstate\s*\/\s*province\b/] },
  { key: "country", label: "Country", group: "Personal", placeholder: "India", patterns: [/^\s*country\b/, /\bcountry of residence\b/] },
  { key: "pincode", label: "PIN / ZIP code", group: "Personal", patterns: [/\b(pin\s*code|pincode|zip|postal\s*code)\b/] },
  { key: "address", label: "Full address", group: "Personal", type: "textarea", patterns: [/\baddress\b(?!.*e-?mail)/] },

  { key: "linkedin", label: "LinkedIn URL", group: "Links", patterns: [/linked\s*in/] },
  { key: "github", label: "GitHub URL", group: "Links", patterns: [/git\s*hub/] },
  { key: "portfolio", label: "Portfolio / website", group: "Links", patterns: [/\b(portfolio|personal\s*(website|site)|website|blog)\b/] },
  { key: "leetcode", label: "LeetCode / coding profile", group: "Links", patterns: [/\b(leetcode|codechef|codeforces|hackerrank|coding\s*profile)\b/] },
  { key: "twitter", label: "Twitter / X", group: "Links", patterns: [/\btwitter\b|\bx\.com\b/] },

  { key: "college", label: "College / university", group: "Education", patterns: [/\b(college|university|institute|institution|school name|alma mater)\b/] },
  { key: "degree", label: "Degree", group: "Education", placeholder: "B.Tech", patterns: [/\b(degree|qualification|highest education)\b/] },
  { key: "branch", label: "Branch / major", group: "Education", placeholder: "Computer Science", patterns: [/\b(branch|major|speciali[sz]ation|stream|discipline|field of study)\b/] },
  { key: "graduationYear", label: "Graduation year", group: "Education", placeholder: "2025", patterns: [/\b(graduation|passing|passout|pass-out|batch)\b.*\byear\b|\byear of (graduation|passing)\b|^\s*batch\b/] },
  { key: "cgpa", label: "CGPA / percentage", group: "Education", patterns: [/\b(cgpa|gpa|cpi|sgpa|aggregate|graduation\s*percentage)\b/] },
  { key: "twelfthPercent", label: "12th percentage", group: "Education", patterns: [/\b(12th|xii|class\s*12|higher secondary|intermediate)\b/] },
  { key: "tenthPercent", label: "10th percentage", group: "Education", patterns: [/\b(10th|class\s*10|ssc|matriculation|high school)\b/] },

  { key: "currentCompany", label: "Current company", group: "Work", patterns: [/\b(current|present|latest)\s*(company|employer|organi[sz]ation)\b/] },
  { key: "currentTitle", label: "Current title", group: "Work", patterns: [/\b(current|present)\s*(title|designation|role|position)\b/] },
  { key: "totalExperience", label: "Total experience (years)", group: "Work", placeholder: "0.5", patterns: [/\b(total|years of|relevant)\s*(work\s*)?experience\b|\bexperience\s*\(in years\)|\bhow many years\b/] },
  { key: "skills", label: "Key skills", group: "Work", type: "textarea", placeholder: "React, Next.js, Node.js, SQL, Python, Power BI", patterns: [/\b(key\s*)?skills\b|\btech(nical)?\s*stack\b/] },
  { key: "summary", label: "Short professional summary", group: "Work", type: "textarea", patterns: [/\b(about (yourself|you)|introduce yourself|summary|tell us about yourself)\b/] },

  { key: "noticePeriod", label: "Notice period", group: "Preferences & logistics", placeholder: "Immediate / 15 days", patterns: [/\bnotice\s*period\b|\bhow soon can you join\b|\bearliest (start|joining) date\b|\bavailability to join\b/] },
  { key: "currentCTC", label: "Current CTC", group: "Preferences & logistics", placeholder: "0 / 4 LPA", patterns: [/\bcurrent\s*(ctc|salary|compensation|package|stipend)\b/] },
  { key: "expectedCTC", label: "Expected CTC", group: "Preferences & logistics", placeholder: "6-8 LPA", patterns: [/\bexpected\s*(ctc|salary|compensation|package|stipend)\b|\bsalary expectation/] },
  { key: "willingToRelocate", label: "Willing to relocate?", group: "Preferences & logistics", placeholder: "Yes", patterns: [/\brelocat/] },
  { key: "workAuthorization", label: "Work authorization", group: "Preferences & logistics", placeholder: "Indian citizen; no sponsorship needed", patterns: [/\b(work authori[sz]ation|authori[sz]ed to work|legally (eligible|authorized)|visa|sponsorship)\b/] },
  { key: "preferredLocations", label: "Preferred locations", group: "Preferences & logistics", placeholder: "Bangalore, Remote", patterns: [/\bpreferred\s*(job\s*)?location/] },
  { key: "howDidYouHear", label: "How did you hear about us (default)", group: "Preferences & logistics", placeholder: "LinkedIn", patterns: [/\bhow did you (hear|find|learn|come)\b|\bsource\b.*\b(hear|referr)/] },
];

export type Preferences = {
  targetRoles: string;
  locations: string;
  experienceLevel: string;
  mustHaveKeywords: string;
  excludeKeywords: string;
  minScoreToNotify: number;
  followUpDays: number;
};

export const DEFAULT_PREFS: Preferences = {
  targetRoles: "Frontend developer, Full-stack developer, Backend / SDE, Data / Business analyst",
  locations: "India, Remote",
  experienceLevel: "Fresher / internship / 0-1 years",
  mustHaveKeywords: "",
  excludeKeywords: "Senior, Lead, Staff, Principal, 5+ years",
  minScoreToNotify: 60,
  followUpDays: 7,
};

export async function getProfile() {
  const row = await prisma.profile.upsert({ where: { id: 1 }, update: {}, create: { id: 1 } });
  return {
    fields: (row.fields ?? {}) as Record<string, string>,
    preferences: { ...DEFAULT_PREFS, ...((row.preferences ?? {}) as Partial<Preferences>) },
  };
}

export function fullNameOf(f: Record<string, string>) {
  return f.fullName || [f.firstName, f.middleName, f.lastName].filter(Boolean).join(" ");
}
