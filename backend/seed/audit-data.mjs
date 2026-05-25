import fs from 'fs';

const data = JSON.parse(fs.readFileSync(new URL('./data.json', import.meta.url), 'utf8'));

function dupes(values) {
  const seen = new Set();
  const dups = new Set();
  for (const value of values) {
    if (seen.has(value)) dups.add(value);
    else seen.add(value);
  }
  return [...dups];
}

function ids(rows) {
  return rows.map((row) => row.id).filter((value) => value !== undefined);
}

const students = data.students ?? [];
const parents = data.parents ?? [];
const staff = data.staff ?? [];
const classes = data.classes ?? [];
const subjects = data.subjects ?? [];

const studentIdSet = new Set(students.map((row) => row.id));
const parentIdSet = new Set(parents.map((row) => row.id));
const staffIdSet = new Set(staff.map((row) => row.id));
const classIdSet = new Set(classes.map((row) => row.id));
const subjectIdSet = new Set(subjects.map((row) => row.id));

const studentParents = data.studentParents ?? [];
const staffChildren = data.staffChildren ?? [];
const studentSiblings = data.studentSiblings ?? [];
const healthDetails = data.healthDetails ?? [];
const otherSignificantData = data.otherSignificantData ?? [];
const previousSchools = data.previousSchools ?? [];
const staffSubjects = data.staffSubjects ?? [];
const classSubjects = data.classSubjects ?? [];
const studentSubjects = data.studentSubjects ?? [];
const studentAttendances = data.studentAttendances ?? [];
const staffAttendances = data.staffAttendances ?? [];
const studentFees = data.studentFees ?? [];
const studentSubjectAssessments = data.studentSubjectAssessments ?? [];
const continuousAssessments = data.continuousAssessments ?? [];

const output = [];
output.push(`top-level keys: ${Object.keys(data).sort().join(', ')}`);
output.push(`students: ${students.length}, duplicate ids: ${dupes(ids(students)).length}`);
output.push(`parents: ${parents.length}, duplicate ids: ${dupes(ids(parents)).length}`);
output.push(`studentParents: ${studentParents.length}, duplicate pairs: ${dupes(studentParents.map((row) => `${row.studentId}:${row.parentId}`)).length}`);
output.push(`staff: ${staff.length}, duplicate ids: ${dupes(ids(staff)).length}`);
output.push(`classes: ${classes.length}, duplicate ids: ${dupes(ids(classes)).length}`);
output.push(`subjects: ${subjects.length}, duplicate ids: ${dupes(ids(subjects)).length}`);

const orphanStudentParents = studentParents.filter((row) => !studentIdSet.has(row.studentId) || !parentIdSet.has(row.parentId));
const orphanStaffChildren = staffChildren.filter((row) => !staffIdSet.has(row.staffId) || !studentIdSet.has(row.studentId));
const orphanStudentSiblings = studentSiblings.filter((row) => !studentIdSet.has(row.studentId) || !studentIdSet.has(row.siblingId));
const orphanHealth = healthDetails.filter((row) => !studentIdSet.has(row.studentId));
const orphanOther = otherSignificantData.filter((row) => !studentIdSet.has(row.studentId));
const orphanPrevious = previousSchools.filter((row) => !studentIdSet.has(row.studentId));
const orphanStaffSubjects = staffSubjects.filter((row) => !staffIdSet.has(row.staffId) || !subjectIdSet.has(row.subjectId));
const orphanClassSubjects = classSubjects.filter((row) => !classIdSet.has(row.classId) || !subjectIdSet.has(row.subjectId));
const orphanStudentSubjects = studentSubjects.filter((row) => !studentIdSet.has(row.studentId) || !subjectIdSet.has(row.subjectId));
const orphanStudentAttendances = studentAttendances.filter((row) => !studentIdSet.has(row.studentId));
const orphanStaffAttendances = staffAttendances.filter((row) => !staffIdSet.has(row.staffId));
const orphanStudentFees = studentFees.filter((row) => !studentIdSet.has(row.studentId));
const orphanAssessments = studentSubjectAssessments.filter((row) => !studentIdSet.has(row.studentId) || !subjectIdSet.has(row.subjectId));
const orphanContinuous = continuousAssessments.filter((row) => !studentIdSet.has(row.studentId) || !subjectIdSet.has(row.subjectId));

output.push(`studentParents orphans: ${orphanStudentParents.length}`);
output.push(`staffChildren orphans: ${orphanStaffChildren.length}`);
output.push(`studentSiblings orphans: ${orphanStudentSiblings.length}`);
output.push(`healthDetails orphans: ${orphanHealth.length}`);
output.push(`otherSignificantData orphans: ${orphanOther.length}`);
output.push(`previousSchools orphans: ${orphanPrevious.length}`);
output.push(`staffSubjects orphans: ${orphanStaffSubjects.length}`);
output.push(`classSubjects orphans: ${orphanClassSubjects.length}`);
output.push(`studentSubjects orphans: ${orphanStudentSubjects.length}`);
output.push(`studentAttendances orphans: ${orphanStudentAttendances.length}`);
output.push(`staffAttendances orphans: ${orphanStaffAttendances.length}`);
output.push(`studentFees orphans: ${orphanStudentFees.length}`);
output.push(`studentSubjectAssessments orphans: ${orphanAssessments.length}`);
output.push(`continuousAssessments orphans: ${orphanContinuous.length}`);

const duplicateStudentRegistrationNumbers = dupes(students.map((row) => row.registrationNumber).filter(Boolean));
const duplicateStaffRegistrationNumbers = dupes(staff.map((row) => row.registrationNumber).filter(Boolean));
const duplicateParentEmails = dupes(parents.map((row) => row.email).filter(Boolean));

const badStudentEnums = students.filter((row) => !['male', 'female', 'other'].includes(row.gender));
const badStaffEnums = staff.filter((row) => !['male', 'female', 'other'].includes(row.gender) || !['teacher', 'non_teaching'].includes(row.staffType));
const badLivingWith = otherSignificantData.filter((row) => !['both_parents', 'mother_only', 'father_only', 'guardian', 'other_person'].includes(row.livingWith));

const missingStudentRequired = students.filter((row) => !row.firstName || !row.lastName || !row.gender || !row.admissionDate);
const missingParentRequired = parents.filter((row) => !row.firstName || !row.lastName);
const missingStaffRequired = staff.filter((row) => !row.firstName || !row.lastName || !row.gender || !row.staffType || !row.hireDate);
const missingClassRequired = classes.filter((row) => !row.name || !row.level || row.capacity === undefined || row.supervisorId === undefined);

const badClassSupervisor = classes.filter((row) => !staffIdSet.has(row.supervisorId));
const badClassSubjectRefs = classes.filter((row) => Array.isArray(row.subjectIds) && row.subjectIds.some((subjectId) => !subjectIdSet.has(subjectId)));

const studentIdGaps = students
  .map((row) => row.id)
  .filter((id, index, allIds) => index === 0 ? id !== 1 : (id !== index + 1 || allIds[index - 1] + 1 !== id));
const parentIdGaps = parents
  .map((row) => row.id)
  .filter((id, index, allIds) => index === 0 ? id !== 1 : (id !== index + 1 || allIds[index - 1] + 1 !== id));

output.push(`students duplicate registrationNumber: ${duplicateStudentRegistrationNumbers.length}`);
output.push(`staff duplicate registrationNumber: ${duplicateStaffRegistrationNumbers.length}`);
output.push(`parents duplicate non-null email: ${duplicateParentEmails.length}`);
output.push(`students missing required: ${missingStudentRequired.length}`);
output.push(`parents missing required: ${missingParentRequired.length}`);
output.push(`staff missing required: ${missingStaffRequired.length}`);
output.push(`classes missing required: ${missingClassRequired.length}`);
output.push(`students invalid gender enum: ${badStudentEnums.length}`);
output.push(`staff invalid enum values: ${badStaffEnums.length}`);
output.push(`otherSignificantData invalid livingWith: ${badLivingWith.length}`);
output.push(`classes bad supervisor references: ${badClassSupervisor.length}`);
output.push(`classes bad subject references: ${badClassSubjectRefs.length}`);
output.push(`student id gaps vs array order: ${studentIdGaps.length}`);
output.push(`parent id gaps vs array order: ${parentIdGaps.length}`);

const emptyParentNames = parents.filter((row) => row.firstName === '' || row.lastName === '');
const longRelationships = studentParents.filter((row) => row.relationship != null && String(row.relationship).length > 50);

output.push(`parents with empty first/last name: ${emptyParentNames.length}`);
output.push(`studentParents relationship > 50 chars: ${longRelationships.length}`);

console.log(output.join('\n'));

if (orphanStudentParents.length) {
  console.log('\nstudentParents orphan examples:');
  console.log(JSON.stringify(orphanStudentParents.slice(0, 10), null, 2));
}

if (emptyParentNames.length) {
  console.log('\nparent empty-name examples:');
  console.log(JSON.stringify(emptyParentNames.slice(0, 10), null, 2));
}

if (longRelationships.length) {
  console.log('\nlong relationship examples:');
  console.log(JSON.stringify(longRelationships.slice(0, 10), null, 2));
}

if (duplicateStaffRegistrationNumbers.length) {
  console.log('\nstaff duplicate registration examples:');
  console.log(JSON.stringify(duplicateStaffRegistrationNumbers.slice(0, 10), null, 2));
}

if (duplicateStudentRegistrationNumbers.length) {
  console.log('\nstudent duplicate registration examples:');
  console.log(JSON.stringify(duplicateStudentRegistrationNumbers.slice(0, 10), null, 2));
}
