// Global variables
let stream = null;
let scannedData = [];
let confirmationModal = null;

// Element selectors
const video = document.getElementById('video');
const canvas = document.getElementById('canvas');
const startCameraBtn = document.getElementById('startCamera');
const stopCameraBtn = document.getElementById('stopCamera');
const captureBtn = document.getElementById('captureBtn');
const fileInput = document.getElementById('fileInput');
const previewContainer = document.getElementById('previewContainer');
const progressContainer = document.querySelector('.progress-container');
const progressBar = document.getElementById('progressBar');
const resultsTableBody = document.getElementById('resultsTableBody');
const totalCount = document.getElementById('totalCount');
const clearAllBtn = document.getElementById('clearAll');
const exportBtn = document.getElementById('exportBtn');
const confirmationTableBody = document.getElementById('confirmationTableBody');
const addAllBtn = document.getElementById('addAllBtn');

document.addEventListener('DOMContentLoaded', () => {
    confirmationModal = new bootstrap.Modal(document.getElementById('confirmationModal'));
});

// Start Camera
startCameraBtn.addEventListener('click', async () => {
    try {
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
        video.srcObject = stream;
        startCameraBtn.disabled = true; stopCameraBtn.disabled = false; captureBtn.disabled = false;
    } catch (error) { alert('Không thể truy cập camera: ' + error.message); }
});

// Stop Camera
stopCameraBtn.addEventListener('click', () => {
    if (stream) {
        stream.getTracks().forEach(track => track.stop());
        video.srcObject = null;
        startCameraBtn.disabled = false; stopCameraBtn.disabled = true; captureBtn.disabled = true;
    }
});

// Capture Photo or File Upload
captureBtn.addEventListener('click', () => {
    canvas.width = video.videoWidth; canvas.height = video.videoHeight;
    canvas.getContext('2d').drawImage(video, 0, 0);
    canvas.toBlob(blob => processImage(blob));
});
fileInput.addEventListener('change', (e) => { if (e.target.files[0]) processImage(e.target.files[0]); });

// Process Image with OCR
async function processImage(imageData) {
    previewContainer.innerHTML = `<img src="${URL.createObjectURL(imageData)}" class="preview-img" alt="Preview">`;
    progressContainer.style.display = 'block'; progressBar.style.width = '0%';
    
    try {
        const result = await Tesseract.recognize(
            imageData, 'vie+eng',
            { logger: m => {
                if (m.status === 'recognizing text') progressBar.style.width = Math.round(m.progress * 100) + '%';
            }}
        );
        progressContainer.style.display = 'none';
        extractAndConfirm(result.data.text);
    } catch (error) {
        alert('Lỗi khi xử lý ảnh: ' + error.message);
        progressContainer.style.display = 'none';
    }
}

// *** IMPROVED LOGIC: Extract all items from text and show confirmation modal ***
function extractAndConfirm(text) {
    const lines = text.split('\n').map(line => line.trim()).filter(line => line.length > 0);
    const foundItems = [];

    for (let i = 0; i < lines.length; i++) {
        const currentLine = lines[i];

        // Regex 1: Find lines with "STT Item Quantity" all in one. E.g., "9 WNK79255 35"
        let match = currentLine.match(/^\s*\d+\s+([A-Z0-9]+)\s+(\d+)\s*$/);
        if (match) {
            foundItems.push({ item: match[1], quantity: parseInt(match[2], 10) });
            continue; // Go to the next line
        }

        // Regex 2: Find lines with "STT Item" only. E.g., "3 100667"
        match = currentLine.match(/^\s*\d+\s+([A-Z0-9]+)\s*$/);
        if (match) {
            const item = match[1];
            let quantity = 1; // Default quantity

            // Look ahead to the next line to see if it's a number (the quantity)
            if (i + 1 < lines.length) {
                const nextLine = lines[i + 1];
                const quantityMatch = nextLine.match(/^\s*(\d+)\s*$/);
                // Make sure the number isn't too large (likely not a quantity) or another item code
                if (quantityMatch && !isNaN(parseInt(quantityMatch[1], 10)) && nextLine.length < 5) {
                    quantity = parseInt(quantityMatch[1], 10);
                    i++; // Skip the next line since we've processed it as a quantity
                }
            }
            foundItems.push({ item: item, quantity: quantity });
        }
    }

    if (foundItems.length === 0) {
        alert('Không tìm thấy item nào hợp lệ. Vui lòng thử lại với ảnh rõ hơn hoặc kiểm tra kết quả OCR.');
        console.log("OCR Result:\n", text); // Log OCR result for debugging
        return;
    }

    confirmationTableBody.innerHTML = foundItems.map((item, index) => `
        <tr data-index="${index}">
            <td><input type="text" class="form-control" value="${item.item}"></td>
            <td><input type="number" class="form-control" value="${item.quantity}" min="1"></td>
            <td><button class="btn btn-sm btn-danger" onclick="this.closest('tr').remove()"><i class="fas fa-trash"></i></button></td>
        </tr>
    `).join('');
    
    confirmationModal.show();
}

// Add all confirmed items to the main list
addAllBtn.addEventListener('click', () => {
    const rows = confirmationTableBody.querySelectorAll('tr');
    rows.forEach(row => {
        const itemInput = row.querySelector('input[type="text"]');
        const quantityInput = row.querySelector('input[type="number"]');
        const item = itemInput.value.trim();
        const quantity = parseInt(quantityInput.value, 10);
        if (item && quantity > 0) addOrUpdateItem(item, quantity);
    });
    confirmationModal.hide();
    previewContainer.innerHTML = '<i class="fas fa-image fa-3x text-muted"></i><p class="text-muted">Ảnh đã chụp hoặc tải lên sẽ hiện ở đây.</p>';
});

// Add or Update Item (merge if duplicate)
function addOrUpdateItem(item, quantity) {
    const existingIndex = scannedData.findIndex(data => data.item.toLowerCase() === item.toLowerCase());
    if (existingIndex !== -1) {
        scannedData[existingIndex].quantity += quantity;
    } else {
        scannedData.push({ item, quantity });
    }
    updateTable();
}

// Update main table display
function updateTable() {
    if (scannedData.length === 0) {
        resultsTableBody.innerHTML = '<tr><td colspan="4" class="text-center text-muted">Chưa có dữ liệu.</td></tr>';
    } else {
        resultsTableBody.innerHTML = scannedData.map((data, index) => `
            <tr>
                <td>${index + 1}</td>
                <td>${data.item}</td>
                <td>${data.quantity}</td>
                <td>
                    <button class="btn btn-sm btn-warning" onclick="editItem(${index})"><i class="fas fa-edit"></i></button>
                    <button class="btn btn-sm btn-danger" onclick="deleteItem(${index})"><i class="fas fa-trash"></i></button>
                </td>
            </tr>
        `).join('');
    }
    totalCount.textContent = scannedData.length;
}

// Edit/Delete/Clear/Export functions
window.editItem = function(index) {
    const data = scannedData[index];
    const newItem = prompt('Sửa Item:', data.item);
    const newQuantity = prompt('Sửa Số lượng:', data.quantity);
    if (newItem !== null && newQuantity !== null) {
        scannedData[index].item = newItem;
        scannedData[index].quantity = parseInt(newQuantity) || data.quantity;
        updateTable();
    }
};
window.deleteItem = function(index) {
    if (confirm('Bạn có chắc muốn xóa mục này?')) {
        scannedData.splice(index, 1);
        updateTable();
    }
};
clearAllBtn.addEventListener('click', () => {
    if (scannedData.length > 0 && confirm('Bạn có chắc muốn xóa tất cả dữ liệu?')) {
        scannedData = []; updateTable();
    }
});
exportBtn.addEventListener('click', () => {
    if (scannedData.length === 0) { alert('Không có dữ liệu để xuất!'); return; }
    const ws = XLSX.utils.json_to_sheet(scannedData.map((d, i) => ({'STT': i + 1, 'Item': d.item, 'Số Lượng': d.quantity})));
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Danh Sách');
    XLSX.writeFile(wb, `Ket_Qua_Quet_${new Date().toISOString().slice(0,10)}.xlsx`);
});

// Initialize
updateTable();
