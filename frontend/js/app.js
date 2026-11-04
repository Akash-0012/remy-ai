"use strict";
const pages=["inventory","shopping","assistant","receipts"];
const labels={inventory:"Inventory",shopping:"Shopping List",assistant:"Remy AI Assistant",receipts:"Receipt Vault"};
let inventoryItems=[], shoppingItems=[], receiptItems=[], deletedItems=[];
let inventoryTypeFilter="all";
let inventoryModalType="all";
let dietaryPreference="None";
let wizard={stage:"category",category:"food",method:"scan",files:[],detected:{},receiptName:"",receiptData:null,receiptItems:[]};
let selectedReceipt=null, scannedReceipt=null;

const catMeta={
 food:{title:"Food & Groceries",icon:"🥑",desc:"Packaged food, beverages and grocery products",expiry:true,locations:["Pantry","Fridge","Freezer","Spice Rack"],units:["kg","g","L","ml","packet","dozen","bunch","piece","pcs"],defaultLocation:"Pantry",categories:[["General","Packaged / general"],["Produce","Fresh produce"]]},
 household:{title:"Household Supplies",icon:"🧴",desc:"Cleaning products, toiletries and everyday consumables",expiry:true,locations:["Cleaning cupboard","Bathroom cabinet","Laundry area","Kitchen cabinet","Utility / storage area"],units:["piece","bottle","pack","box","roll","pair","set","L","ml","kg","g","pcs"],defaultLocation:"",categories:[["Cleaning","Cleaning"],["Personal Care","Personal care"],["Household","Other household"]]},
 asset:{title:"Assets & Equipment",icon:"🔌",desc:"Electronics, appliances, furniture and valuable items",expiry:false,locations:["Bedroom","Living room","Office / study","Kitchen","Storage room","Garage"],units:["piece","unit","set","pair","box","pcs"],defaultLocation:"",categories:[["Asset","Asset / equipment"]]}
};
async function api(url, options={}){
 const res=await fetch(url,{...options,headers:{...(options.body?{"Content-Type":"application/json"}:{}),...(options.headers||{})}});
 const data=await res.json().catch(()=>({}));
 if(!res.ok) throw new Error(data.error||data.message||`Request failed (${res.status})`);
 return data;
}
function showPage(name){
 if(!pages.includes(name))return;
 pages.forEach(p=>{const sec=document.getElementById("page-"+p);if(sec)sec.classList.toggle("active",p===name)});
 document.querySelectorAll(".nav button[data-page]").forEach(b=>b.classList.toggle("active",b.dataset.page===name));
 const crumb=document.getElementById("crumb");if(crumb)crumb.textContent=labels[name];
}
document.querySelectorAll(".nav button[data-page]").forEach(b=>b.addEventListener("click",()=>showPage(b.dataset.page)));

function openModal(){wizard={stage:"category",category:"food",method:"scan",files:[],detected:{},receiptName:"",receiptData:null,receiptItems:[]};document.getElementById("modalback").classList.add("show");renderWizard();}
function closeModal(){document.getElementById("modalback").classList.remove("show");}
function chooseCategory(c){
 wizard.category=c;wizard.files=[];wizard.detected={};
 // Assets & Equipment skips the method screen completely and opens manual details.
 if(c==="asset"){wizard.stage="form";wizard.method="manual";}
 else {wizard.stage="method";wizard.method="";}
 renderWizard();
}
function chooseAddMethod(method){
 // Guard against opening photo/AI scanning for Assets & Equipment.
 if(wizard.category==="asset")method="manual";
 wizard.method=method;
 if(method==="manual"){wizard.stage="form";wizard.detected={};}
 else {wizard.stage="upload";}
 renderWizard();
}
function wizardBack(){
 if(wizard.stage==="category"){closeModal();return}
 if(wizard.stage==="method")wizard.stage="category";
 else if(wizard.stage==="upload")wizard.stage="method";
 else if(wizard.stage==="scanreview")wizard.stage="upload";
 else if(wizard.stage==="form"){
  // Back from an asset form returns to category selection, never to the removed scan/manual screen.
  if(wizard.category==="asset")wizard.stage="category";
  else wizard.stage=wizard.method==="scan"?"scanreview":"method";
 }
 renderWizard();
}
function renderWizard(){
 const body=document.getElementById("wizardbody"),title=document.getElementById("wizardtitle"),desc=document.getElementById("wizarddesc"),back=document.getElementById("wizardback"),next=document.getElementById("wizardnext");
 const steps=document.querySelector(".wizardsteps");
 const assetFlow=wizard.category==="asset";
 const stageIndex=assetFlow?(wizard.stage==="form"?1:0):({category:0,method:1,upload:2,scanreview:3,form:3}[wizard.stage]??0);
 ["step1","step2","step3","step4"].forEach((id,i)=>{let el=document.getElementById(id);if(el){el.classList.toggle("active",i===stageIndex);el.classList.toggle("done",i<stageIndex);}});
 if(steps){
  const stepEls=steps.querySelectorAll(".step");
  const separators=steps.querySelectorAll("i");
  if(assetFlow){
   // Show only Category → Details for assets; no Method or Scan step.
   if(stepEls[0])stepEls[0].querySelector("small").textContent="Category";
   if(stepEls[3])stepEls[3].querySelector("small").textContent="Details";
   [1,2].forEach(i=>{if(stepEls[i])stepEls[i].style.display="none";});
   separators.forEach((el,i)=>el.style.display=i===0?"block":"none");
   if(stepEls[3]){stepEls[3].classList.toggle("active",wizard.stage==="form");stepEls[3].classList.toggle("done",wizard.stage!=="form");}
  }else{
   if(stepEls[0])stepEls[0].querySelector("small").textContent="Category";
   if(stepEls[1]){stepEls[1].style.display="";stepEls[1].querySelector("small").textContent="Method";}
   if(stepEls[2]){stepEls[2].style.display="";stepEls[2].querySelector("small").textContent="Scan";}
   if(stepEls[3]){stepEls[3].style.display="";stepEls[3].querySelector("small").textContent="Details";}
   separators.forEach(el=>el.style.display="");
  }
 }
 back.style.display=wizard.stage==="category"?"none":"inline-block";
 const topBack=document.getElementById("wizardtopback");if(topBack)topBack.style.display=wizard.stage==="category"?"none":"inline-flex";
 next.style.display=["category","method"].includes(wizard.stage)?"none":"inline-block";
 next.disabled=false;
 if(wizard.stage==="category"){
  title.textContent="What are you adding?";desc.textContent="Choose the type of item.";
  body.innerHTML=`<div class="categorychoices">
  <button class="categorychoice" onclick="chooseCategory('food')"><span class="bigicon" style="background:#e8f3e9">🥑</span><div><b>Food & Groceries</b><p>Packaged food, beverages and grocery products</p></div></button>
  <button class="categorychoice" onclick="chooseCategory('household')"><span class="bigicon" style="background:#f4eaf0">🧴</span><div><b>Household Supplies</b><p>Cleaning products, toiletries and daily consumables</p></div></button>
  <button class="categorychoice" onclick="chooseCategory('asset')"><span class="bigicon" style="background:#eaf0f8">🔌</span><div><b>Assets & Equipment</b><p>Electronics, appliances, furniture and valuables</p></div></button></div>`;
 }else if(wizard.stage==="method"){
  if(wizard.category==="asset"){wizard.stage="form";wizard.method="manual";renderWizard();return;}
  const c=catMeta[wizard.category];
  title.textContent="How would you like to add it?";desc.textContent="Choose one method. Automatic scanning opens a separate upload and camera screen.";
  body.innerHTML=`<div class="methodgrid method-choice-grid">
  <button class="methodcard scan method-select" onclick="chooseAddMethod('scan')"><div class="methodicon">✦</div><div class="methodbadge">AUTOMATIC</div><h3>Scan product information</h3><p>Upload or capture product photos. Remy will read the label, search barcode/QR data when possible, and prefill the form.</p><span class="method-cta">Continue to scan →</span></button>
  <button class="methodcard manual method-select" onclick="chooseAddMethod('manual')"><div class="methodicon" style="background:#f4eee5">✎</div><div class="methodbadge muted">MANUAL</div><h3>Enter details manually</h3><p>Skip scanning and fill in the item details yourself. You can still edit every field before saving.</p><span class="method-cta">Enter details →</span></button></div>
  ${wizard.category==="asset"?'<p class="formhint">Barcode databases mainly cover packaged food. For electronics and household assets, automatic name lookup may be limited; manual entry is always available.</p>':""}`;
 }else if(wizard.stage==="upload"){
  title.textContent="Automatic scan";desc.textContent="First upload or capture the product image. Then scan it and review the results.";
  body.innerHTML=`<div class="uploadscan-panel">
   <div class="uploadscan-hero"><div class="scan-hero-icon">⌕</div><h3>Upload or capture product photos</h3><p>For best results, take a clear photo of the front label, expiry date, and barcode/QR code. You can add multiple angles.</p></div>
   <div class="scan-upload-actions"><label class="scan-upload-btn" for="productupload">↑ Upload image(s)</label><label class="scan-upload-btn secondary" for="productcamera">◎ Capture with camera</label>
   <input id="productupload" type="file" accept="image/*" multiple hidden onchange="productFiles(this)">
   <input id="productcamera" type="file" accept="image/*" capture="environment" hidden onchange="productFiles(this)"></div>
   <div class="image-quality-note"><b>Image tips</b><ul><li>Keep the product name and expiry date in focus.</li><li>For barcodes, fill the frame and avoid glare.</li><li>Use front and back photos if the details are on different sides.</li></ul></div>
   <div id="scanfiles" class="scanfiles">${wizard.files.map((f,i)=>scanFileCard(f,i)).join("")}</div>
   <p class="formhint">Up to 6 photos, each under 12 MB. Large images are resized/compressed for AI processing while barcode reading also tries enhanced image versions.</p>
  </div>`;
  next.textContent=wizard.files.length?"Scan images with Remy →":"Choose images to continue";next.disabled=wizard.files.length===0;
 }else if(wizard.stage==="scanreview"){
  title.textContent="Scan results";desc.textContent="Review what Remy found. Missing or uncertain details can be entered manually next.";
  body.innerHTML=scanSummaryHtml();next.textContent="Continue to item details →";next.disabled=false;
 }else if(wizard.stage==="form"){
  title.textContent=(wizard.method==="scan"?"Review scanned item":"Manual item details");desc.textContent="Complete missing information, check the values, then save to inventory.";
  body.innerHTML=reviewFormHtml();next.textContent="Add to inventory";next.disabled=false;
 }
}
async function wizardNext(){
 const next=document.getElementById("wizardnext");
 if(wizard.stage==="category"||wizard.stage==="method")return;
 if(wizard.stage==="upload"){
  if(!wizard.files.length){toast("Upload or capture at least one product image first.");return}
  next.disabled=true;next.textContent="Scanning images…";
  try{
   const imgs=await Promise.all(wizard.files.map(fileToData));
   wizard.detected=await api("/api/analyze_images",{method:"POST",body:JSON.stringify({images:imgs,itemType:wizard.category,type:"both"})});
   wizard.stage="scanreview";renderWizard();
   toast(wizard.detected.message||"Scan finished. Please review the results.");
  }catch(e){toast(e.message);next.disabled=false;next.textContent="Try scan again →";}
  return;
 }
 if(wizard.stage==="scanreview"){wizard.stage="form";renderWizard();return}
 if(wizard.stage==="form")await saveWizardItem();
}
function scanFileCard(file,index){
 const size=(file.size/1024/1024).toFixed(2);
 const url=URL.createObjectURL(file);
 return `<div class="scan-file-card"><img src="${url}" alt="Selected product photo" onload="showImageDimensions(this,${index})"><div class="scan-file-info"><b>${escapeText(file.name)}</b><small>${size} MB · ${file.type||"image"}</small><small id="scan-dim-${index}">Reading image dimensions…</small></div><button type="button" class="scan-file-remove" onclick="removeProductFile(${index})" aria-label="Remove ${escapeAttr(file.name)}">×</button></div>`;
}
function showImageDimensions(img,index){
 const el=document.getElementById("scan-dim-"+index);
 if(el)el.textContent=img.naturalWidth+" × "+img.naturalHeight+" px";
}
function productFiles(input){
 if(!input.files?.length)return;
 const incoming=Array.from(input.files);
 const tooLarge=incoming.find(f=>f.size>12*1024*1024);
 if(tooLarge){toast(tooLarge.name+" is over 12 MB. Please choose a smaller image.");input.value="";return}
 if(wizard.files.length+incoming.length>6){toast("You can select up to 6 product photos.");input.value="";return}
 wizard.files=[...wizard.files,...incoming];wizard.method="scan";renderWizard();toast(wizard.files.length+" photo(s) ready to scan.");
}
function removeProductFile(index){wizard.files.splice(index,1);renderWizard();}
function fileToData(file){return new Promise((resolve,reject)=>{const r=new FileReader();r.onload=()=>resolve({imageBase64:r.result,mimeType:file.type||"image/jpeg"});r.onerror=()=>reject(new Error("Could not read "+file.name));r.readAsDataURL(file);});}
function scanSummaryHtml(){
 const d=wizard.detected||{};
 const fields=[['Item name',d.name],['Brand',d.brand],['Expiry date',d.expiryDate],['Quantity',d.quantity||d.qty],['Price',d.price],['Barcode / QR',d.barcode]];
 const found=fields.filter(x=>x[1]!==undefined&&x[1]!==null&&String(x[1]).trim()!=="");
 const missing=fields.filter(x=>x[0]!=="Barcode / QR"&&(x[1]===undefined||x[1]===null||String(x[1]).trim()===""));
 const fileNames=wizard.files.map(f=>escapeText(f.name)).join(" · ");
 const missingHtml=missing.length?`<div class="missing-notice"><b>Still needs your input</b><p>${missing.map(x=>escapeText(x[0])).join(", ")}. Fill these manually on the next screen. Required fields are marked with *.</p></div>`:`<div class="success-notice">The main details were detected. Please verify them before saving.</div>`;
 return `<div class="scan-summary"><div class="scan-summary-icon">✦</div><div><b>Scan complete</b><p>${escapeText(d.message||"Review these results. AI can only fill details that are visible and readable in the photo.")}</p><small>${wizard.files.length} image(s): ${fileNames||"No image name available"}</small></div></div>
 <div class="scan-result-head"><b>Information detected</b><span class="scan-count">${found.length} of ${fields.length} fields</span></div>
 <div class="scan-result-grid">${fields.map(([label,value])=>`<div class="scan-result ${value!==undefined&&value!==null&&String(value).trim()!==""?"detected":"not-detected"}"><span>${escapeText(label)}</span><b>${value!==undefined&&value!==null&&String(value).trim()!==""?escapeText(value):"Not detected"}</b></div>`).join("")}</div>
 ${missingHtml}
 <p class="formhint">Please check the actual package. AI may misread small print, dates, or barcodes. Nothing is added until you press Save item.</p>`;
}
function reviewFormHtml(){
 const c=catMeta[wizard.category],d=wizard.detected||{};
 const locationValue=String(d.location||c.defaultLocation||"");
 const locationOptions=c.locations.map(x=>`<option value="${escapeAttr(x)}"></option>`).join("");
 const unitValue=d.unit|| (wizard.category==="food"?"kg":"piece");
 const unitOptions=c.units.map(x=>`<option value="${escapeAttr(x)}" ${x===unitValue?"selected":""}>${escapeText(x)}</option>`).join("");
 const categoryValue=wizard.category==="food"
  ? (["General","Produce"].includes(d.category)?d.category:"General")
  :wizard.category==="household"
   ? (["Cleaning","Personal Care","Household"].includes(d.category)?d.category:"Household")
   :"Asset";
 const categoryOptions=c.categories.map(([value,label])=>`<option value="${escapeAttr(value)}" ${value===categoryValue?"selected":""}>${escapeText(label)}</option>`).join("");
 const name=d.name||"",brand=d.brand||"",qty=d.quantity||d.qty||"1",price=d.price||"",expiry=d.expiryDate||"";
 const scanInfo=wizard.method==="scan"?`<div class="formhint" style="margin-bottom:12px">${escapeText(d.message||"AI scan results are suggestions. Check the values before saving.")}${d.barcode?`<br>Barcode/QR decoded: ${escapeText(d.barcode)} · ${escapeText(d.identifiedBy||"decoder")}`:""}</div>`:"";
 const categoryField=wizard.category==="asset"
  ? `<div class="field"><label>ITEM CATEGORY</label><input value="Assets & equipment" disabled><input id="wizcategory" type="hidden" value="Asset"></div>`
  : `<div class="field"><label>ITEM CATEGORY *</label><select id="wizcategory" required>${categoryOptions}</select></div>`;
 const expiryField=wizard.category==="asset"
  ? `<div class="field"><label>WARRANTY EXPIRY (OPTIONAL)</label><input id="wizwarranty" type="date" value="${escapeAttr(d.warrantyDate||"")}"><div class="formhint">Only enter a confirmed warranty end date. Leave blank if unknown or not applicable.</div></div>`
  : `<div class="field"><label>${wizard.category==="food"?"EXPIRY / BEST BEFORE":"EXPIRY DATE"} ${wizard.category==="food"?"*":"(OPTIONAL)"}</label><input id="wizexpiry" type="date" value="${escapeAttr(expiry)}" ${wizard.category==="food"?"required":""}><div class="formhint">${wizard.category==="food"?"Required: enter the date printed on the package.":"Enter it if the product has a printed expiry date; otherwise leave blank."}</div></div>`;
 return scanInfo+`<div class="field"><label>ITEM NAME *</label><input id="wizname" value="${escapeAttr(name)}" maxlength="200" placeholder="${wizard.category==="asset"?"e.g. Laptop, mixer, chair":"e.g. Milk, detergent, oats"}" required></div>
 <div class="fieldrow">${categoryField}<div class="field"><label>BRAND / MANUFACTURER (OPTIONAL)</label><input id="wizbrand" value="${escapeAttr(brand)}" placeholder="Brand or manufacturer"></div></div>
 <div class="fieldrow"><div class="field"><label>QUANTITY *</label><input id="wizqty" type="number" min="1" max="100000" step="1" value="${escapeAttr(qty)}" required><div class="formhint">Whole number of units/items.</div></div><div class="field"><label>UNIT</label><select id="wizunit">${unitOptions}</select></div></div>
 <div class="fieldrow"><div class="field"><label>TOTAL PURCHASE PRICE (₹)</label><input id="wizprice" type="number" min="0" step="0.01" value="${escapeAttr(price)}" placeholder="Optional"><div class="formhint">Total paid for this quantity, not per-unit price.</div></div><div class="field"><label>BARCODE / REFERENCE ID (OPTIONAL)</label><input id="wizbarcode" value="${escapeAttr(d.barcode||"")}" maxlength="80" placeholder="Barcode or asset reference"></div></div>
 <div class="fieldrow"><div class="field"><label>LOCATION *</label><input id="wizlocation" list="wizlocation-options" value="${escapeAttr(locationValue)}" maxlength="100" placeholder="${wizard.category==="food"?"e.g. Pantry, Fridge":"Type where you keep it"}" required><datalist id="wizlocation-options">${locationOptions}</datalist><div class="formhint">Choose a suggestion or type your own location.</div></div>${expiryField}</div>
 <div class="field"><label>NOTES (OPTIONAL)</label><input id="wiznotes2" value="${escapeAttr(d.notes||"")}" maxlength="500" placeholder="${wizard.category==="asset"?"Model, serial number, condition…":"Extra product details or reminders"}"></div>
 <p class="formhint">Review all details before adding. Only the item name, quantity, location, and category-specific date are required; brand, price, barcode/reference, and notes are optional.</p>`;
}
function escapeText(s){return String(s??"").replace(/[&<>"]/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c]));}
function escapeAttr(s){return escapeText(s);}
async function saveWizardItem(){
 const name=document.getElementById("wizname")?.value.trim();
 const location=document.getElementById("wizlocation")?.value.trim();
 const qtyValue=document.getElementById("wizqty")?.value;
 const quantity=Number(qtyValue);
 const expiry=document.getElementById("wizexpiry")?.value||"";
 const warranty=document.getElementById("wizwarranty")?.value||"";
 if(!name){toast("Please enter the item name.");document.getElementById("wizname")?.focus();return}
 if(!location){toast("Please enter or choose a location.");document.getElementById("wizlocation")?.focus();return}
 if(!Number.isInteger(quantity)||quantity<1||quantity>100000){toast("Quantity must be a whole number from 1 to 100000.");document.getElementById("wizqty")?.focus();return}
 if(wizard.category==="food"&&!expiry){toast("Please enter the expiry / best-before date for food.");document.getElementById("wizexpiry")?.focus();return}
 const itemType=wizard.category;
 const category=itemType==="food"?(document.getElementById("wizcategory")?.value||"General")
  :itemType==="household"?(document.getElementById("wizcategory")?.value||"Household"):"Asset";
 const payload={
  name,category,itemType,expiryDate:expiry,warrantyDate:warranty,location,
  quantity,unit:document.getElementById("wizunit")?.value||"pcs",
  price:document.getElementById("wizprice")?.value||null,
  brand:document.getElementById("wizbrand")?.value||"",
  barcode:document.getElementById("wizbarcode")?.value||wizard.detected?.barcode||"",
  notes:document.getElementById("wiznotes2")?.value||""
 };
 try{await api("/api/inventory",{method:"POST",body:JSON.stringify(payload)});closeModal();await loadInventory();toast("Item saved to your inventory.");}
 catch(e){toast(e.message)}
}
function toast(msg){const t=document.getElementById("toast");t.textContent=msg;t.classList.add("show");clearTimeout(window.toastTimer);window.toastTimer=setTimeout(()=>t.classList.remove("show"),3200);}
function formatMoney(n){return n==null||n===""?"—":"₹ "+Number(n).toLocaleString("en-IN",{maximumFractionDigits:2});}
function itemTypeName(x){return x==="food"?"Food & groceries":x==="household"?"Household supplies":"Assets & equipment";}
async function loadInventory(){
 try{inventoryItems=await api("/api/inventory");renderInventory();if(document.getElementById("inventory-list-modal")?.classList.contains("show"))renderInventoryListModal();if(document.getElementById("expiry-list-modal")?.classList.contains("show"))renderExpiryListModal();}catch(e){toast("Inventory load failed: "+e.message);}
}
function renderInventory(){
 const cont=document.getElementById("inventoryproducts");if(!cont)return;
 const query=(document.getElementById("inventory-search")?.value||"").trim().toLowerCase();
 const filtered=inventoryItems.filter(p=>(inventoryModalType==="all"||p.itemType===inventoryModalType)&&(!query||[p.name,p.brand,p.location,p.category,p.itemType,p.barcode].some(v=>String(v||"").toLowerCase().includes(query))));
 if(!inventoryItems.length){cont.innerHTML='<p class="formhint">Your inventory is empty. Use “Add item” to scan or add your first item.</p>';}
 else if(!filtered.length){cont.innerHTML='<p class="formhint">No inventory items match this category or search. <button class="textlink" onclick="showAllInventory()">Show all items</button></p>';}
 else cont.innerHTML=filtered.map(p=>`<div class="product inventory-product" role="button" tabindex="0" onclick="openInventoryItem(${p.id})" onkeydown="if(event.key==='Enter'||event.key===' ')openInventoryItem(${p.id})"><div class="productpic">${p.itemType==="food"?"🥑":p.itemType==="household"?"🧴":"🔌"}</div><div><b>${escapeText(p.name)}</b><small>${escapeText(itemTypeName(p.itemType))} · ${escapeText(p.location||"Pantry")}${p.expiryDate?" · Expiry "+escapeText(p.expiryDate):p.warrantyDate?" · Warranty "+escapeText(p.warrantyDate):""}</small><small>Qty: ${escapeText(p.quantity??1)} ${escapeText(p.unit||"pcs")}${p.brand?" · "+escapeText(p.brand):""}</small></div><div class="price">${formatMoney(p.price)}<small><br><button class="textlink" onclick="event.stopPropagation();deleteInventory(${p.id})">Remove</button></small></div></div>`).join("");
 const stats=document.querySelectorAll("#page-inventory .stats .stat strong");
 if(stats.length>=4){stats[0].textContent=inventoryItems.length;const total=inventoryItems.reduce((a,p)=>a+(Number(p.price)||0),0);stats[1].textContent=formatMoney(total);const soon=inventoryItems.filter(p=>p.expiryDate&&daysTo(p.expiryDate)>=0&&daysTo(p.expiryDate)<=7).length;stats[2].textContent=soon;stats[3].textContent=shoppingItems.filter(x=>!x.completed).length;}
 const cats=document.querySelectorAll("#page-inventory .category");
 ["food","household","asset"].forEach((type,i)=>{const list=inventoryItems.filter(p=>p.itemType===type);if(cats[i]){const foot=cats[i].querySelector(".catfoot");if(foot){foot.children[0].textContent=list.length+" items";foot.children[1].textContent=formatMoney(list.reduce((a,p)=>a+(Number(p.price)||0),0));}}});
 renderExpiryWatch();renderCategoryValueChart();
 const zoneCount=new Set(inventoryItems.map(p=>p.location).filter(Boolean)).size;const zoneEl=document.getElementById("storage-zone-count");if(zoneEl)zoneEl.textContent=zoneCount+" active";
 const warrantyEl=document.getElementById("warranty-count");if(warrantyEl)warrantyEl.textContent=inventoryItems.filter(p=>p.warrantyDate).length+" tracked";
}
function getExpiryItems(){
 return inventoryItems.filter(p=>p.expiryDate&&String(p.expiryDate).trim()).sort((a,b)=>String(a.expiryDate).localeCompare(String(b.expiryDate))||String(a.name||"").localeCompare(String(b.name||"")));
}
function expiryDaysLabel(date){
 const days=daysTo(date);
 if(days<0)return `${Math.abs(days)} day${Math.abs(days)===1?"":"s"} overdue`;
 if(days===0)return "Today";
 if(days===1)return "Tomorrow";
 return `${days} days`;
}
function expiryRowHTML(p){
 const days=daysTo(p.expiryDate),date=new Date(p.expiryDate+"T00:00:00"),month=date.toLocaleDateString("en-IN",{month:"short"}),day=date.getDate();
 const tagClass=days<0||days<=1?"red":"orange";
 return `<div class="expiryrow"><div class="datebox ${tagClass}"><span>${escapeText(month)}</span>${day}</div><div class="expiry-meta"><b>${escapeText(p.name)}</b><small>${escapeText(p.location||"Pantry")} · ${escapeText(p.quantity??1)} ${escapeText(p.unit||"pcs")}</small></div><span class="tag ${tagClass}">${escapeText(expiryDaysLabel(p.expiryDate))}</span></div>`;
}
function renderExpiryWatch(){
 const box=document.getElementById("expiry-watch");if(!box)return;
 const exp=getExpiryItems().slice(0,10);
 box.innerHTML=exp.map(expiryRowHTML).join("")||`<div class="expiry-empty"><span class="expiry-empty-icon">✓</span><b>No expiry dates yet</b><p>Items with expiry dates will appear here.</p></div>`;
 const insight=document.getElementById("expiry-insight");if(insight)insight.textContent=exp.length?`Your ${Math.min(10,exp.length)} closest expiry item${exp.length===1?"":"s"} are shown above. Open “View all” to search every expiry date.`:"No expiry dates are recorded in your inventory.";
}
function renderCategoryValueChart(){
 const chart=document.getElementById("category-value-chart"),legend=document.getElementById("category-value-legend");if(!chart||!legend)return;
 const types=[{key:"food",label:"Food & groceries",color:"#36a66a"},{key:"household",label:"Household supplies",color:"#bd82ad"},{key:"asset",label:"Assets & equipment",color:"#719bd6"}].map(t=>({...t,value:inventoryItems.filter(p=>p.itemType===t.key).reduce((sum,p)=>sum+(Number(p.price)||0),0)}));
 const total=types.reduce((sum,t)=>sum+t.value,0);
 // Preserve the true proportions in the legend. For the donut only, give every
 // non-zero category a 1.5% minimum slice so small categories remain visible.
 const positive=types.filter(t=>t.value>0);
 const minSlice=1.5;
 const totalMinimum=positive.length*minSlice;
const largest = positive.length
    ? positive.reduce((a, b) => a.value >= b.value ? a : b)
    : null;
 const weights=types.map(t=>{
  if(t.value<=0)return 0;
  if(positive.length===1)return 100;
  const raw=t.value/total*100;
  return Math.max(minSlice,raw);
 });
 const excess=weights.reduce((sum,v)=>sum+v,0)-100;
 if(excess>0&&largest){
  const idx=types.findIndex(t=>t.key===largest.key);
  weights[idx]=Math.max(minSlice,weights[idx]-excess);
 }
 let cumulative=0;
 const segments=types.map((t,i)=>{
  const start=cumulative;
  cumulative+=weights[i];
  return `${t.color} ${start}% ${cumulative}%`;
 }).join(", ");
 const percentLabel=value=>{
  if(!total||!value)return "0%";
  const pct=value/total*100;
  return pct<1?`${pct.toFixed(2)}%`:`${pct.toFixed(1).replace(/\\.0$/,"")}%`;
 };
 chart.innerHTML=`<div class="donut" style="background:${total?`conic-gradient(${segments})`:"conic-gradient(#e8eee9 0% 100%)"}"><div class="donut-center"><strong>${formatMoney(total)}</strong><span>Total value</span></div></div>`;
 legend.innerHTML=types.map(t=>`<div class="chartlegend-row"><span class="legend-name"><i style="background:${t.color}"></i>${t.label}</span><b>${formatMoney(t.value)}</b><small>${percentLabel(t.value)}</small></div>`).join("");
}
function openListModal(id){const modal=document.getElementById(id);if(!modal)return;modal.classList.add("show");modal.setAttribute("aria-hidden","false");document.body.classList.add("modal-open");const input=modal.querySelector("input[type=search]");if(input){input.value="";setTimeout(()=>input.focus(),50);}}
function closeListModal(id){const modal=document.getElementById(id);if(!modal)return;modal.classList.remove("show");modal.setAttribute("aria-hidden","true");if(!document.querySelector(".list-modal-back.show,.modalback.show,.receipt-review-overlay.show"))document.body.classList.remove("modal-open");}
function openInventoryListModal(type="all"){
 inventoryModalType=["food","household","asset"].includes(type)?type:"all";
 const title=document.getElementById("inventory-list-title");
 if(title)title.textContent=inventoryModalType==="all"?"All inventory items":itemTypeName(inventoryModalType);
 openListModal("inventory-list-modal");renderInventoryListModal();
}
function openCategoryInventoryModal(type){openInventoryListModal(type);}
function renderInventoryListModal(){
 const box=document.getElementById("inventory-modal-list"),count=document.getElementById("inventory-list-count");if(!box)return;
 const query=(document.getElementById("inventory-modal-search")?.value||"").trim().toLowerCase();
 const items=inventoryItems.filter(p=>!query||[p.name,p.brand,p.location,p.category,p.itemType,p.barcode].some(v=>String(v||"").toLowerCase().includes(query)));
 if(count)count.textContent=`${items.length} of ${inventoryItems.length} items · Search and browse your saved items.`;
 box.innerHTML=items.map(p=>`<div class="product inventory-product"><div class="productpic">${p.itemType==="food"?"🥑":p.itemType==="household"?"🧴":"🔌"}</div><div><b>${escapeText(p.name)}</b><small>${escapeText(itemTypeName(p.itemType))} · ${escapeText(p.location||"Pantry")}${p.expiryDate?" · Expiry "+escapeText(p.expiryDate):p.warrantyDate?" · Warranty "+escapeText(p.warrantyDate):""}</small><small>Qty: ${escapeText(p.quantity??1)} ${escapeText(p.unit||"pcs")}${p.brand?" · "+escapeText(p.brand):""}</small></div><div class="price">${formatMoney(p.price)}<small><br><button class="textlink" onclick="deleteInventory(${p.id})">Remove</button></small></div></div>`).join("")||'<div class="list-empty">No inventory items match your search.</div>';
}
function openExpiryListModal(){openListModal("expiry-list-modal");renderExpiryListModal();}
function renderExpiryListModal(){
 const box=document.getElementById("expiry-modal-list"),count=document.getElementById("expiry-list-count");if(!box)return;
 const query=(document.getElementById("expiry-modal-search")?.value||"").trim().toLowerCase();
 const items=getExpiryItems().filter(p=>!query||[p.name,p.brand,p.location,p.category,p.itemType,p.expiryDate].some(v=>String(v||"").toLowerCase().includes(query)));
 if(count)count.textContent=`${items.length} item${items.length===1?"":"s"} with expiry dates · Sorted by nearest expiry.`;
 box.innerHTML=items.map(expiryRowHTML).join("")||'<div class="list-empty">No expiry dates match your search.</div>';
}
function openInventoryItem(id){
 const p=inventoryItems.find(x=>Number(x.id)===Number(id));if(!p)return;
 document.getElementById("itemdetailtitle").textContent=p.name||"Inventory item";
 const fields=[ ["Category",itemTypeName(p.itemType)], ["Brand",p.brand], ["Quantity",`${p.quantity??1} ${p.unit||"pcs"}`], ["Price",formatMoney(p.price)], ["Storage",p.location||"Pantry"], [p.itemType==="asset"?"Warranty expiry":"Expiry / best before",p.itemType==="asset"?p.warrantyDate:p.expiryDate], ["Barcode",p.barcode], ["Notes",p.notes] ].filter(x=>x[1]!==undefined&&x[1]!==null&&x[1]!=="");
 document.getElementById("itemdetailbody").innerHTML=`<div class="detailgrid">${fields.map(([k,v])=>`<div class="detailfield"><small>${escapeText(k)}</small><b>${escapeText(v)}</b></div>`).join("")}</div><p class="formhint">This detail view reflects the saved inventory record. To change it, remove the item and add it again with corrected details (editing is not currently supported by the backend).</p><button class="secondary" onclick="deleteInventory(${p.id})">Remove item</button>`;
 document.getElementById("itemdetailback").classList.add("show");
}
function closeItemDetails(){document.getElementById("itemdetailback")?.classList.remove("show");}
function showAllInventory(){inventoryTypeFilter="all";const search=document.getElementById("inventory-search");if(search)search.value="";renderInventory();}
function filterInventoryType(type){inventoryTypeFilter=type;const search=document.getElementById("inventory-search");if(search)search.value="";renderInventory();}
function showExpiryCalendar(){openExpiryListModal();}
function daysTo(d){const n=new Date(d+"T00:00:00"),now=new Date();now.setHours(0,0,0,0);return Math.round((n-now)/86400000);}
async function deleteInventory(id){if(!confirm("Remove this item from inventory?"))return;try{await api(`/api/inventory/${id}`,{method:"DELETE"});closeItemDetails();await loadInventory();toast("Item removed.");}catch(e){toast(e.message)}}

async function loadShopping(){try{shoppingItems=await api("/api/shopping");renderShopping();renderInventory();}catch(e){toast("Shopping list load failed: "+e.message)}}
function renderShopping(){const box=document.getElementById("shoppingitems");if(!box)return;box.innerHTML=shoppingItems.map(x=>`<div class="shoppingrow"><input type="checkbox" onchange="checkShopping(this)"><div class="itemmeta"><b>${escapeText(x.name)}</b><small>${escapeText(x.category||"General")} · Qty ${x.quantity||1}</small></div><span class="amount"><button class="textlink" onclick="deleteShopping(${x.id})">Remove</button></span></div>`).join("")||'<p class="formhint">Your shopping list is empty.</p>';document.getElementById("shoppingcount").textContent=shoppingItems.length;document.getElementById("completedcount").textContent=box.querySelectorAll("input:checked").length;}
async function addShopping(){const name=prompt("What do you need to buy?");if(!name?.trim())return;const qty=prompt("Quantity (optional)","1")||"1";try{await api("/api/shopping",{method:"POST",body:JSON.stringify({name:name.trim(),quantity:qty,category:"General"})});await loadShopping();toast("Added to shopping list.");}catch(e){toast(e.message)}}
async function deleteShopping(id){try{await api(`/api/shopping/${id}`,{method:"DELETE"});await loadShopping();toast("Removed from shopping list.");}catch(e){toast(e.message)}}
function checkShopping(el){document.getElementById("completedcount").textContent=document.querySelectorAll("#shoppingitems input:checked").length;document.getElementById("shoppingcount").textContent=document.querySelectorAll("#shoppingitems input:not(:checked)").length;}
function suggest(s){document.getElementById("chatinput").value=s;document.getElementById("chatinput").focus();}
async function sendChat(e){
 e.preventDefault();const inp=document.getElementById("chatinput"),promptText=inp.value.trim();if(!promptText)return;
 const box=document.getElementById("chatmessages"),user=document.createElement("div");user.className="message user";user.textContent=promptText;box.appendChild(user);inp.value="";
 const loading=document.createElement("div");loading.className="message";loading.textContent="Remy is thinking…";box.appendChild(loading);box.scrollTop=box.scrollHeight;
 try{const isRecipe=/recipe|cook|meal|dish|chef/i.test(promptText);const result=await api("/api/chat",{method:"POST",body:JSON.stringify({prompt:promptText,inventory:inventoryItems,deletedItems,isRecipe,dietary:dietaryPreference})});loading.innerHTML=(result.text||result.reply||result.response||"Remy returned no response.")+"<small>Remy · Now</small>";}
 catch(err){loading.textContent="Sorry, I couldn't get a response: "+err.message;}
 box.scrollTop=box.scrollHeight;
}
function addRecipeMode(){dietaryPreference=prompt("Dietary preference: None, Vegetarian, Vegan, Gluten-Free, Dairy-Free, or Keto","None")||"None";const ask="Suggest 3 recipes using my inventory and respecting my dietary preference.";document.getElementById("chatinput").value=ask;document.getElementById("chatinput").focus();}

function receiptSelected(input){
 selectedReceipt=input.files?.[0]||null;scannedReceipt=null;
 const label=document.getElementById("receiptselected");if(label)label.textContent=selectedReceipt?`Selected: ${selectedReceipt.name} (${Math.round(selectedReceipt.size/1024)} KB)`:"No receipt selected";
 const scan=document.getElementById("scanreceiptbtn"),save=document.getElementById("savereceiptbtn");if(scan)scan.disabled=!selectedReceipt;if(save)save.disabled=!selectedReceipt;
 const review=document.getElementById("receiptreview");if(review)review.style.display="none";
}
async function scanReceiptPreview(){
 if(!selectedReceipt)return;
 if(selectedReceipt.type==="application/pdf"){toast("PDFs can be saved in Receipt Vault, but AI extraction currently accepts receipt images (JPG/PNG/WEBP).");return}
 try{
  const image=await fileToData(selectedReceipt);
  scannedReceipt=await api("/api/analyze_receipt",{method:"POST",body:JSON.stringify({images:[image]})});
  renderReceiptReview();
  toast("Receipt scanned. Review the extracted details in the popup.");
 }catch(e){toast(e.message);}
}
function ensureReceiptReviewModal(){
 let modal=document.getElementById("receipt-review-modal");if(modal)return modal;
 modal=document.createElement("div");modal.id="receipt-review-modal";modal.className="receipt-review-overlay";modal.setAttribute("role","dialog");modal.setAttribute("aria-modal","true");modal.setAttribute("aria-labelledby","receipt-review-title");
 modal.innerHTML=`<section class="receipt-review-modal"><header class="receipt-review-header"><div><span class="receipt-review-eyebrow">REMY RECEIPT SCAN</span><h2 id="receipt-review-title">Review extracted receipt</h2><p>Check the store, date, total and item details before saving.</p></div><button type="button" class="receipt-review-close" aria-label="Close receipt review" onclick="closeReceiptReview()">×</button></header><div id="receipt-review-content" class="receipt-review-content"></div><footer class="receipt-review-footer"><button type="button" class="secondary" onclick="closeReceiptReview()">Close</button><button type="button" class="primary" onclick="saveReceiptPreview()">Save receipt to Vault</button></footer></section>`;
 document.body.appendChild(modal);modal.addEventListener("click",e=>{if(e.target===modal)closeReceiptReview();});return modal;
}
function closeReceiptReview(){document.getElementById("receipt-review-modal")?.classList.remove("show");}
function renderReceiptReview(){
 const modal=ensureReceiptReviewModal(),box=document.getElementById("receipt-review-content"),items=scannedReceipt?.items||[];
 box.innerHTML=`<div class="receipt-review-fields"><div class="field"><label>STORE</label><input id="rcstore" value="${escapeAttr(scannedReceipt.store||"")}" placeholder="Store name"></div><div class="field"><label>RECEIPT DATE</label><input id="rcdate" type="date" value="${escapeAttr(scannedReceipt.receiptDate||"")}"></div><div class="field"><label>RECEIPT TOTAL (₹)</label><input id="rctotal" type="number" min="0" step="0.01" value="${escapeAttr(scannedReceipt.total??"")}" placeholder="Total amount"></div></div>
 <div class="receipt-review-items-head"><div><h3>Extracted items</h3><p>Edit fields before adding them to inventory.</p></div><span>${items.length} item${items.length===1?"":"s"}</span></div>
 ${items.length?items.map((it,i)=>`<article class="receipt-review-item"><div class="receipt-review-item-top"><span class="receipt-item-number">${i+1}</span><strong>Item ${i+1}</strong><button type="button" class="receipt-remove-item" onclick="removeReceiptItem(${i})" aria-label="Remove item ${i+1}">×</button></div><div class="receipt-item-fields"><div class="field"><label>ITEM NAME *</label><input id="rci-name-${i}" value="${escapeAttr(it.name||"")}" placeholder="Item name"></div><div class="field"><label>TYPE</label><select id="rci-type-${i}">${[["food","Food & Groceries"],["household","Household Supplies"],["asset","Assets & Equipment"]].map(([v,l])=>`<option value="${v}" ${(it.itemType||"food")===v?"selected":""}>${l}</option>`).join("")}</select></div><div class="field"><label>QUANTITY</label><input id="rci-qty-${i}" type="number" min="0.01" step="any" value="${escapeAttr(it.quantity??1)}"></div><div class="field"><label>UNIT</label><input id="rci-unit-${i}" value="${escapeAttr(it.unit||"pcs")}" placeholder="pcs, kg, packet"></div><div class="field"><label>UNIT PRICE (₹)</label><input id="rci-price-${i}" type="number" min="0" step="0.01" value="${escapeAttr(it.unitPrice??"")}" placeholder="Optional"></div><div class="field"><label>LINE TOTAL (₹)</label><input id="rci-total-${i}" type="number" min="0" step="0.01" value="${escapeAttr(it.totalPrice??"")}" placeholder="Optional"></div></div><div class="receipt-item-actions"><button type="button" class="secondary" onclick="addReceiptItem(${i})">Review & add to inventory</button></div></article>`).join(""):'<div class="receipt-review-empty">No line items were confidently extracted. You can still save the original receipt to your vault.</div>'}
 <p class="receipt-review-note">AI extraction may miss or misread printed details. Verify the receipt before saving or adding items.</p>`;
 modal.classList.add("show");
}
function readReceiptItem(i){
 const original=scannedReceipt?.items?.[i]||{},get=id=>document.getElementById(id)?.value;
 return {...original,name:get(`rci-name-${i}`)?.trim()||"",itemType:get(`rci-type-${i}`)||"food",quantity:get(`rci-qty-${i}`)||1,unit:get(`rci-unit-${i}`)||"pcs",unitPrice:get(`rci-price-${i}`)||null,totalPrice:get(`rci-total-${i}`)||null};
}
function removeReceiptItem(i){if(!scannedReceipt?.items)return;scannedReceipt.items.splice(i,1);renderReceiptReview();}
function addReceiptItem(i){
 const item=readReceiptItem(i);if(!item.name){toast("Please enter the item name before adding it to inventory.");document.getElementById(`rci-name-${i}`)?.focus();return;}
 wizard={stage:"form",category:["food","household","asset"].includes(item.itemType)?item.itemType:"food",method:"manual",files:[],detected:{name:item.name,quantity:item.quantity,unit:item.unit,price:item.unitPrice||item.totalPrice||"",category:"General"}};
 closeReceiptReview();document.getElementById("modalback")?.classList.add("show");renderWizard();toast("Review the receipt item and complete any missing required fields.");
}
async function saveReceiptPreview(){
 if(!selectedReceipt){toast("Select a receipt file first.");return;}
 try{
  const editedItems=(scannedReceipt?.items||[]).map((_,i)=>readReceiptItem(i));
  const data=await fileToData(selectedReceipt);
  const details={...(scannedReceipt||{}),store:document.getElementById("rcstore")?.value||"",receiptDate:document.getElementById("rcdate")?.value||"",total:document.getElementById("rctotal")?.value||null,items:editedItems};
  await api("/api/receipts",{method:"POST",body:JSON.stringify({fileData:data.imageBase64,fileName:selectedReceipt.name,details})});
  selectedReceipt=null;scannedReceipt=null;
  const label=document.getElementById("receiptselected");if(label)label.textContent="Receipt saved in your database-backed vault.";
  const scan=document.getElementById("scanreceiptbtn"),save=document.getElementById("savereceiptbtn");if(scan)scan.disabled=true;if(save)save.disabled=true;
  const review=document.getElementById("receiptreview");if(review)review.style.display="none";
  closeReceiptReview();await loadReceiptVault();toast("Receipt saved to Receipt Vault.");
 }catch(e){toast(e.message)}
}
async function loadReceiptVault(){
 try{const receipts=await api("/api/receipts");document.getElementById("receiptcount").textContent=receipts.length;document.getElementById("receiptfilecount").textContent=receipts.length;const overviewReceipts=document.getElementById("overview-receipt-count");if(overviewReceipts)overviewReceipts.textContent=receipts.length+" saved";
 const cont=document.getElementById("savedreceipts");cont.innerHTML=receipts.map(r=>`<div class="savedreceipt"><div class="receipticon">🧾</div><div class="receiptmeta"><b>${escapeText(r.original_name||"Receipt")}</b><small>${escapeText(r.store||"Store not detected")} · ${escapeText(r.receipt_date||"Date not detected")} · ${Math.round((r.file_size||0)/1024)} KB</small></div><div class="receiptbuttons"><button onclick="viewReceipt(${r.id})">View</button><button onclick="downloadReceipt(${r.id})">Download</button><button onclick="deleteReceipt(${r.id})">Delete</button></div></div>`).join("")||'<p class="formhint">No receipts saved yet.</p>';
 }catch(e){toast("Receipt Vault load failed: "+e.message)}
}
function viewReceipt(id){window.open(`/api/receipts/${id}/file`,"_blank","noopener");}
function downloadReceipt(id){const a=document.createElement("a");a.href=`/api/receipts/${id}/file?download=1`;a.download="receipt";a.click();}
async function deleteReceipt(id){if(!confirm("Delete this saved receipt and its file?"))return;try{await api(`/api/receipts/${id}`,{method:"DELETE"});await loadReceiptVault();toast("Receipt deleted.");}catch(e){toast(e.message)}}
function refreshReceiptVault(){loadReceiptVault();toast("Receipt Vault refreshed.");}

async function init(){
 const todayChip=document.getElementById("today-chip");if(todayChip)todayChip.textContent="◷  "+new Date().toLocaleDateString("en-IN",{weekday:"long",month:"short",day:"numeric"});
 try{const health=await api("/api/health");const badge=document.getElementById("connection-status");if(badge)badge.textContent=health.groq_configured?"Backend connected · AI ready":"Backend connected · Add Groq API key";}catch(_){}
 await Promise.all([loadInventory(),loadShopping(),loadReceiptVault()]);
}
window.showPage=showPage;window.openInventoryItem=openInventoryItem;window.closeItemDetails=closeItemDetails;window.showAllInventory=showAllInventory;window.filterInventoryType=filterInventoryType;window.showExpiryCalendar=showExpiryCalendar;window.openModal=openModal;window.closeModal=closeModal;window.chooseCategory=chooseCategory;window.wizardBack=wizardBack;window.wizardNext=wizardNext;window.productFiles=productFiles;window.saveWizardItem=saveWizardItem;window.toast=toast;window.addShopping=addShopping;window.checkShopping=checkShopping;window.deleteShopping=deleteShopping;window.suggest=suggest;window.sendChat=sendChat;window.receiptSelected=receiptSelected;window.scanReceiptPreview=scanReceiptPreview;window.saveReceiptPreview=saveReceiptPreview;window.addReceiptItem=addReceiptItem;window.closeReceiptReview=closeReceiptReview;window.removeReceiptItem=removeReceiptItem;window.refreshReceiptVault=refreshReceiptVault;window.viewReceipt=viewReceipt;window.downloadReceipt=downloadReceipt;window.deleteReceipt=deleteReceipt;window.addRecipeMode=addRecipeMode;window.deleteInventory=deleteInventory;
document.addEventListener("DOMContentLoaded",init);


document.addEventListener("keydown",event=>{if(event.key==="Escape"){closeListModal("inventory-list-modal");closeListModal("expiry-list-modal");}});

