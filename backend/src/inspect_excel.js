const XLSX = require('xlsx');
const path = require('path');

const filePath = 'd:\\all c\\Desktop\\crm-test\\backend\\src\\FitnessVitness_CRM_v4.xlsx';

try {
    const workbook = XLSX.readFile(filePath);
    console.log('Sheet Names:', workbook.SheetNames);

    const sheetName = 'FV-001';
    const worksheet = workbook.Sheets[sheetName];
    const data = XLSX.utils.sheet_to_json(worksheet, { header: 1 });
    console.log(`\n--- Full Data for Sheet: ${sheetName} ---`);
    data.forEach((row, index) => {
        if (row && row.length > 0) {
            console.log(`Row ${index}:`, row);
        }
    });
} catch (error) {
    console.error('Error reading Excel file:', error.message);
}
