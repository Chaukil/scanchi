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

// Camera and UI functions
startCameraBtn.addEventListener('click', async () => {
    try {
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
        video.srcObject = stream;
        startCameraBtn.disabled = true; stopCameraBtn.disabled = false; captureBtn.disabled = false;
    } catch (error) { alert('Không thể truy cập camera: ' + error.message); }
});

stopCameraBtn.addEventListener('click', () => {
    if (stream) {
        stream.getTracks().forEach(track => track.stop());
        video.srcObject = null;
        startCameraBtn.disabled = false; stopCameraBtn.disabled = true; captureBtn.disabled = true;
    }
});

captureBtn.addEventListener('click', () => {
    canvas.width = video.videoWidth; canvas.height = video.videoHeight;
    canvas.getContext('2d').drawImage(video, 0, 0);
    canvas.toBlob(blob => processImage(blob));
});
fileInput.addEventListener('change', (e) => { if (e.target.files[0]) processImage(e.target.files[0]); });

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
        extractAndConfirm(result.data); // Pass the entire data object
    } catch (error) {
        alert('Lỗi khi phân tích ảnh: ' + error.message);
        progressContainer.style.display = 'none';
    }
}

// =========================================================================
// *** VERSION 4 LOGIC: Robust Column Definition using Midpoint ***
// =========================================================================
function extractAndConfirm(data) {
    const words = data.words;
    let itemHeader = null;
    let quantityHeader = null;

    // 1. Find the header objects for "ITEM" and "SỐ LƯỢNG"
    for (const word of words) {
        const wText = word.text.toLowerCase();
        if (!itemHeader && /item/i.test(wText)) {
            itemHeader = word;
        }
        if (!quantityHeader && /lượng|luong/i.test(wText)) {
            quantityHeader = word;
        }
        if (itemHeader && quantityHeader) break; // Stop when both are found
    }

    if (!itemHeader || !quantityHeader) {
        alert('Không tìm thấy tiêu đề cột "ITEM" hoặc "SỐ LƯỢNG". Vui lòng đảm bảo ảnh chụp rõ ràng.');
        console.error("Headers not found. Full text:", data.text);
        return;
    }
    
    // 2. Define column boundary using the midpoint between the two headers
    const midpointX = (itemHeader.bbox.x1 + quantityHeader.bbox.x0) / 2;
    const headersBottomY = Math.max(itemHeader.bbox.y1, quantityHeader.bbox.y1);

    // 3. Group all words into either the item column or quantity column
    const itemWords = [];
    const quantityWords = [];

    for (const word of words) {
        // Must be below the headers
        if (word.bbox.y0 < headersBottomY) continue;

        const wordCenterX = (word.bbox.x0 + word.bbox.x1) / 2;

        // Check if word looks like an item code and is in the item column
        if (wordCenterX < midpointX && /^[A-Z0-9-]{5,}/.test(word.text)) {
            itemWords.push(word);
        }
        // Check if word is a number and is in the quantity column
        else if (wordCenterX > midpointX && /^\d+$/.test(word.text)) {
            quantityWords.push(word);
        }
    }
    
    // 4. Match items to quantities based on vertical alignment (Y-coordinate)
    const foundPairs = [];
    for (const item of itemWords) {
        let bestMatch = null;
        let smallestYDiff = Infinity;

        for (const quantity of quantityWords) {
            const yDiff = Math.abs(item.bbox.y0 - quantity.bbox.y0);
            // Find the quantity on the same "line" (small vertical difference)
            if (yDiff < (item.bbox.height * 1.5) && yDiff < smallestYDiff) {
                smallestYDiff = yDiff;
                bestMatch = quantity;
            }
        }

        if (bestMatch) {
            foundPairs.push({
                item: item.text,
                quantity: parseInt(bestMatch.text, 10)
            });
            // Remove the matched quantity to prevent it from being matched again
            const index = quantityWords.indexOf(bestMatch);
            if (index > -1) {
                quantityWords.splice(index, 1);
            }
        } else {
             // If an item has no matching quantity, add it with a default of 1
             foundPairs.push({ item: item.text, quantity: 1 });
        }
    }

    if (foundPairs.length === 0) {
        alert('Không tìm thấy cặp Item-Số lượng nào. Vui lòng thử lại với ảnh rõ hơn.');
        console.log("Item candidates:", itemWords.map(w => w.text));
        console.log("Quantity candidates:", quantityWords.map(w => w.text));
        return;
    }

    // 5. Show confirmation modal
    confirmationTableBody.innerHTML = foundPairs.map((pair, index) => `
        <tr data-index="${index}">
            <td><input type="text" class="form-control" value="${pair.item}"></td>
            <td><input type="number" class="form-control" value="${pair.quantity}" min="1"></td>
            <td><button class="btn btn-sm btn-danger" onclick="this.closest('tr').remove()"><i class="fas fa-trash"></i></button></td>
        </tr>
    `).join('');
    
    confirmationModal.show();
}


// --- Functions for adding, updating, and managing the main list (no changes) ---

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
    previewContainer.innerHTML = '<i class="fas fa-image fa-3x text-muted"></i><p class="text-muted mt-2">Ảnh đã chụp sẽ hiện ở đây.</p>';
});

function addOrUpdateItem(item, quantity) {
    const existingIndex = scannedData.findIndex(data => data.item.toLowerCase() === item.toLowerCase());
    if (existingIndex !== -1) {
        scannedData[existingIndex].quantity += quantity;
    } else {
        scannedData.push({ item, quantity });
    }
    updateTable();
}

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
