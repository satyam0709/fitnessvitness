const xlsx = require('xlsx');
const fs = require('fs');

const workbook = xlsx.readFile('src/FitnessVitness_CRM_v4.xlsx');
for (const sheetName of workbook.SheetNames) {
    console.log(`\n\n=== Sheet: ${sheetName} ===\n`);
    const worksheet = workbook.Sheets[sheetName];
    const data = xlsx.utils.sheet_to_json(worksheet, { header: 1 });
    data.forEach(row => {
        if (row.length > 0) {
            console.log(row.join(' | '));
        }
    });
}
