/**
 * Proposal (KP) Generator - Генератор коммерческих предложений
 * Формирование КП на основе kosztorys_estimates
 */

import { supabase } from './supabase';

export interface ProposalData {
  estimate: any;
  request: any;
  items: any[];
  equipment: any[];
  totals: {
    workTotal: number;
    materialTotal: number;
    equipmentTotal: number;
    laborHoursTotal: number;
    subtotal: number;
    marginPercent: number;
    marginAmount: number;
    discountPercent: number;
    discountAmount: number;
    finalTotal: number;
  };
  company?: any;
}

/**
 * Load data for proposal generation
 */
export async function loadProposalData(estimateId: string): Promise<ProposalData | null> {
  try {
    // Load estimate
    const { data: estimate, error } = await supabase
      .from('kosztorys_estimates')
      .select('*')
      .eq('id', estimateId)
      .single();

    if (error || !estimate) return null;

    // Load request separately
    let request = null;
    if (estimate.request_id) {
      const { data: reqData } = await supabase
        .from('kosztorys_requests')
        .select('*')
        .eq('id', estimate.request_id)
        .single();
      request = reqData;
    }

    // Load items
    const { data: items } = await supabase
      .from('kosztorys_estimate_items')
      .select('*')
      .eq('estimate_id', estimateId)
      .order('position_number');

    // Load equipment
    const { data: equipment } = await supabase
      .from('kosztorys_estimate_equipment')
      .select('*')
      .eq('estimate_id', estimateId);

    // Load company info for header
    let company = null;
    if (estimate.company_id) {
      const { data: companyData } = await supabase
        .from('companies')
        .select('*')
        .eq('id', estimate.company_id)
        .single();
      company = companyData;
    }

    // Use correct column names: subtotal_net, total_works, total_materials, total_equipment, total_gross
    const subtotal = estimate.subtotal_net || estimate.total_gross || 0;
    const marginPercent = estimate.margin_percent || 0;
    const discountPercent = estimate.discount_percent || 0;
    const marginAmount = subtotal * marginPercent / 100;
    const afterMargin = subtotal + marginAmount;
    const discountAmount = afterMargin * discountPercent / 100;
    const finalTotal = afterMargin - discountAmount;

    return {
      estimate: { ...estimate, request },
      request,
      items: items || [],
      equipment: equipment || [],
      totals: {
        workTotal: estimate.total_works || 0,
        materialTotal: estimate.total_materials || 0,
        equipmentTotal: estimate.total_equipment || 0,
        laborHoursTotal: 0,
        subtotal,
        marginPercent,
        marginAmount,
        discountPercent,
        discountAmount,
        finalTotal: estimate.total_gross || finalTotal,
      },
      company,
    };
  } catch (error) {
    console.error('Error loading proposal data:', error);
    return null;
  }
}

/**
 * Generate proposal number
 */
export function generateProposalNumber(prefix: string = 'KP'): string {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const random = String(Math.floor(Math.random() * 10000)).padStart(4, '0');
  return `${prefix}-${year}${month}-${random}`;
}

/**
 * Create proposal in database
 */
export async function createProposal(
  estimateId: string,
  companyId: string,
  createdById: string,
  validDays: number = 30
): Promise<{ success: boolean; proposalId?: string; error?: string }> {
  try {
    const data = await loadProposalData(estimateId);
    if (!data) {
      return { success: false, error: 'Nie można załadować danych kosztorysu' };
    }

    const validUntil = new Date();
    validUntil.setDate(validUntil.getDate() + validDays);

    const { data: proposal, error } = await supabase
      .from('kosztorys_proposals')
      .insert({
        estimate_id: estimateId,
        request_id: data.request?.id,
        company_id: companyId,
        proposal_number: generateProposalNumber(),
        status: 'draft',
        valid_until: validUntil.toISOString().split('T')[0],
        work_total: data.totals.workTotal,
        material_total: data.totals.materialTotal,
        equipment_total: data.totals.equipmentTotal,
        subtotal: data.totals.subtotal,
        margin_percent: data.totals.marginPercent,
        discount_percent: data.totals.discountPercent,
        final_total: data.totals.finalTotal,
        created_by_id: createdById,
      })
      .select()
      .single();

    if (error) {
      return { success: false, error: error.message };
    }

    // Update estimate status
    await supabase
      .from('kosztorys_estimates')
      .update({ status: 'sent' })
      .eq('id', estimateId);

    // Update request status
    if (data.request?.id) {
      await supabase
        .from('kosztorys_requests')
        .update({ status: 'kp_sent' })
        .eq('id', data.request.id);
    }

    return { success: true, proposalId: proposal.id };
  } catch (error: any) {
    return { success: false, error: error.message };
  }
}

/**
 * Generate proposal HTML for printing/PDF
 */
export function generateProposalHTML(data: ProposalData, proposalNumber: string, validUntil: string): string {
  const formatCurrency = (value: number) =>
    value.toLocaleString('pl-PL', { style: 'currency', currency: 'PLN' });

  const formatDate = (date: string) =>
    new Date(date).toLocaleDateString('pl-PL', { day: '2-digit', month: '2-digit', year: 'numeric' });

  // Group items by room
  const itemsByRoom = data.items.reduce((acc: any, item: any) => {
    const room = item.room_group || item.room_name || 'Inne';
    if (!acc[room]) acc[room] = [];
    acc[room].push(item);
    return acc;
  }, {});

  return `
<!DOCTYPE html>
<html lang="pl">
<head>
  <meta charset="UTF-8">
  <title>Oferta handlowa ${proposalNumber}</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: 'Segoe UI', Arial, sans-serif; font-size: 10pt; color: #333; padding: 30px; max-width: 210mm; margin: 0 auto; }

    .header { display: flex; justify-content: space-between; margin-bottom: 30px; padding-bottom: 20px; border-bottom: 3px solid #1e40af; }
    .logo { font-size: 24pt; font-weight: bold; color: #1e40af; }
    .logo-subtitle { font-size: 10pt; color: #64748b; margin-top: 5px; }
    .proposal-info { text-align: right; }
    .proposal-number { font-size: 14pt; font-weight: bold; color: #1e40af; }
    .proposal-date { color: #64748b; margin-top: 5px; }

    .title { font-size: 20pt; font-weight: bold; color: #1e40af; text-align: center; margin: 30px 0; text-transform: uppercase; }

    .parties { display: grid; grid-template-columns: 1fr 1fr; gap: 40px; margin-bottom: 30px; }
    .party { padding: 20px; border-radius: 8px; }
    .party.from { background: #f8fafc; }
    .party.to { background: #eff6ff; border: 1px solid #bfdbfe; }
    .party-label { font-size: 9pt; color: #64748b; text-transform: uppercase; letter-spacing: 1px; margin-bottom: 10px; }
    .party-name { font-size: 12pt; font-weight: bold; color: #1e293b; margin-bottom: 5px; }
    .party-detail { color: #475569; font-size: 10pt; line-height: 1.6; }

    .investment { background: linear-gradient(135deg, #1e40af 0%, #3b82f6 100%); color: white; padding: 20px; border-radius: 8px; margin-bottom: 30px; }
    .investment-label { font-size: 9pt; opacity: 0.8; text-transform: uppercase; letter-spacing: 1px; }
    .investment-name { font-size: 16pt; font-weight: bold; margin-top: 5px; }
    .investment-address { margin-top: 10px; opacity: 0.9; }

    .section { margin-bottom: 25px; }
    .section-title { font-size: 12pt; font-weight: bold; color: #1e40af; padding: 10px 15px; background: #eff6ff; border-left: 4px solid #1e40af; margin-bottom: 10px; }

    table { width: 100%; border-collapse: collapse; margin: 10px 0; }
    th { background: #f1f5f9; padding: 10px 12px; text-align: left; font-size: 9pt; font-weight: bold; color: #475569; text-transform: uppercase; border-bottom: 2px solid #e2e8f0; }
    td { padding: 10px 12px; border-bottom: 1px solid #e2e8f0; vertical-align: top; }
    .text-right { text-align: right; }
    .text-center { text-align: center; }
    tr:hover { background: #f8fafc; }

    .section-subtotal { background: #f1f5f9; font-weight: bold; }
    .section-subtotal td { padding: 8px 12px; border-top: 2px solid #cbd5e1; }

    .summary { margin-top: 30px; page-break-inside: avoid; }
    .summary-box { background: #f8fafc; border-radius: 8px; padding: 20px; }
    .summary-row { display: flex; justify-content: space-between; padding: 8px 0; border-bottom: 1px solid #e2e8f0; }
    .summary-row:last-child { border-bottom: none; }
    .summary-row.subtotal { font-weight: bold; color: #1e293b; padding-top: 15px; border-top: 2px solid #cbd5e1; margin-top: 10px; }
    .summary-row.final { font-size: 16pt; font-weight: bold; color: #1e40af; background: #1e40af; color: white; margin: 15px -20px -20px; padding: 20px; border-radius: 0 0 8px 8px; }

    .validity { margin-top: 30px; padding: 15px 20px; background: #fef3c7; border-left: 4px solid #f59e0b; border-radius: 0 8px 8px 0; }
    .validity-label { font-weight: bold; color: #92400e; }
    .validity-date { color: #78350f; }

    .terms { margin-top: 30px; padding: 20px; background: #f8fafc; border-radius: 8px; }
    .terms-title { font-weight: bold; color: #1e293b; margin-bottom: 10px; }
    .terms-content { font-size: 9pt; color: #64748b; line-height: 1.8; }
    .terms-content li { margin-bottom: 5px; }

    .signatures { margin-top: 50px; display: grid; grid-template-columns: 1fr 1fr; gap: 50px; }
    .signature { text-align: center; }
    .signature-line { border-top: 1px solid #cbd5e1; margin-top: 60px; padding-top: 10px; }
    .signature-label { font-size: 9pt; color: #64748b; }

    .footer { margin-top: 50px; text-align: center; font-size: 9pt; color: #94a3b8; padding-top: 20px; border-top: 1px solid #e2e8f0; }

    @media print {
      body { padding: 15mm; }
      .section { page-break-inside: avoid; }
    }
  </style>
</head>
<body>
  <div class="header">
    <div>
      <div class="logo">${data.company?.name || 'FIRMA'}</div>
      <div class="logo-subtitle">${data.company?.address || ''}</div>
    </div>
    <div class="proposal-info">
      <div class="proposal-number">${proposalNumber}</div>
      <div class="proposal-date">Data: ${formatDate(new Date().toISOString())}</div>
    </div>
  </div>

  <div class="title">Oferta Handlowa</div>

  <div class="parties">
    <div class="party from">
      <div class="party-label">Wykonawca</div>
      <div class="party-name">${data.company?.name || 'Firma'}</div>
      <div class="party-detail">
        ${data.company?.address || ''}<br>
        ${data.company?.tax_id ? `NIP: ${data.company.tax_id}` : ''}<br>
        ${data.company?.email ? `Email: ${data.company.email}` : ''}<br>
        ${data.company?.phone ? `Tel: ${data.company.phone}` : ''}
      </div>
    </div>
    <div class="party to">
      <div class="party-label">Zamawiający</div>
      <div class="party-name">${data.request?.client_name || 'Klient'}</div>
      <div class="party-detail">
        ${data.request?.contact_person ? `Osoba kontaktowa: ${data.request.contact_person}` : ''}<br>
        ${data.request?.email ? `Email: ${data.request.email}` : ''}<br>
        ${data.request?.phone ? `Tel: ${data.request.phone}` : ''}
      </div>
    </div>
  </div>

  <div class="investment">
    <div class="investment-label">Przedmiot oferty</div>
    <div class="investment-name">${data.request?.investment_name || 'Instalacje elektryczne'}</div>
    <div class="investment-address">${data.request?.address || ''}</div>
  </div>

  ${Object.entries(itemsByRoom).map(([room, roomItems]: [string, any]) => `
    <div class="section">
      <div class="section-title">${room}</div>
      <table>
        <thead>
          <tr>
            <th style="width: 5%">Lp.</th>
            <th style="width: 45%">Opis pracy</th>
            <th style="width: 10%" class="text-center">J.m.</th>
            <th style="width: 10%" class="text-right">Ilość</th>
            <th style="width: 15%" class="text-right">Cena j.</th>
            <th style="width: 15%" class="text-right">Wartość</th>
          </tr>
        </thead>
        <tbody>
          ${(roomItems as any[]).map((item: any, i: number) => `
            <tr>
              <td class="text-center">${i + 1}</td>
              <td>${item.work_name || '-'}</td>
              <td class="text-center">${item.unit || 'szt'}</td>
              <td class="text-right">${item.quantity || 0}</td>
              <td class="text-right">${formatCurrency(item.unit_price || 0)}</td>
              <td class="text-right">${formatCurrency(item.total_price || 0)}</td>
            </tr>
          `).join('')}
          <tr class="section-subtotal">
            <td colspan="5">Razem ${room}:</td>
            <td class="text-right">${formatCurrency((roomItems as any[]).reduce((sum: number, item: any) => sum + (item.total_price || 0), 0))}</td>
          </tr>
        </tbody>
      </table>
    </div>
  `).join('')}

  ${data.equipment.length > 0 ? `
    <div class="section">
      <div class="section-title">Sprzęt i urządzenia</div>
      <table>
        <thead>
          <tr>
            <th style="width: 5%">Lp.</th>
            <th style="width: 45%">Nazwa sprzętu</th>
            <th style="width: 10%" class="text-center">J.m.</th>
            <th style="width: 10%" class="text-right">Ilość</th>
            <th style="width: 15%" class="text-right">Cena j.</th>
            <th style="width: 15%" class="text-right">Wartość</th>
          </tr>
        </thead>
        <tbody>
          ${data.equipment.map((eq: any, i: number) => `
            <tr>
              <td class="text-center">${i + 1}</td>
              <td>${eq.equipment_name || '-'}</td>
              <td class="text-center">${eq.unit || 'szt'}</td>
              <td class="text-right">${eq.quantity || 0}</td>
              <td class="text-right">${formatCurrency(eq.unit_price || 0)}</td>
              <td class="text-right">${formatCurrency(eq.total_price || 0)}</td>
            </tr>
          `).join('')}
          <tr class="section-subtotal">
            <td colspan="5">Razem sprzęt:</td>
            <td class="text-right">${formatCurrency(data.totals.equipmentTotal)}</td>
          </tr>
        </tbody>
      </table>
    </div>
  ` : ''}

  <div class="summary">
    <div class="summary-box">
      <div class="summary-row">
        <span>Wartość prac:</span>
        <span>${formatCurrency(data.totals.workTotal)}</span>
      </div>
      <div class="summary-row">
        <span>Wartość materiałów:</span>
        <span>${formatCurrency(data.totals.materialTotal)}</span>
      </div>
      ${data.equipment.length > 0 ? `
        <div class="summary-row">
          <span>Wartość sprzętu:</span>
          <span>${formatCurrency(data.totals.equipmentTotal)}</span>
        </div>
      ` : ''}
      <div class="summary-row subtotal">
        <span>Suma netto:</span>
        <span>${formatCurrency(data.totals.subtotal)}</span>
      </div>
      ${data.totals.marginPercent > 0 ? `
        <div class="summary-row">
          <span>Marża (${data.totals.marginPercent}%):</span>
          <span>+${formatCurrency(data.totals.marginAmount)}</span>
        </div>
      ` : ''}
      ${data.totals.discountPercent > 0 ? `
        <div class="summary-row">
          <span>Rabat (${data.totals.discountPercent}%):</span>
          <span>-${formatCurrency(data.totals.discountAmount)}</span>
        </div>
      ` : ''}
      <div class="summary-row final">
        <span>RAZEM DO ZAPŁATY:</span>
        <span>${formatCurrency(data.totals.finalTotal)}</span>
      </div>
    </div>
  </div>

  <div class="validity">
    <span class="validity-label">Oferta ważna do:</span>
    <span class="validity-date">${formatDate(validUntil)}</span>
  </div>

  <div class="terms">
    <div class="terms-title">Warunki realizacji:</div>
    <div class="terms-content">
      <ul>
        <li>Termin realizacji: do uzgodnienia</li>
        <li>Warunki płatności: 30% zaliczki, reszta po zakończeniu prac</li>
        <li>Gwarancja: 24 miesiące od daty odbioru</li>
        <li>Ceny nie zawierają podatku VAT (23%)</li>
        <li>Oferta nie stanowi zamówienia</li>
      </ul>
    </div>
  </div>

  <div class="signatures">
    <div class="signature">
      <div class="signature-line">
        <div class="signature-label">Podpis Wykonawcy</div>
      </div>
    </div>
    <div class="signature">
      <div class="signature-line">
        <div class="signature-label">Podpis Zamawiającego</div>
      </div>
    </div>
  </div>

  <div class="footer">
    Dokument wygenerowany automatycznie • ${formatDate(new Date().toISOString())}
  </div>
</body>
</html>
  `;
}

/**
 * Download proposal as HTML/PDF (opens print dialog)
 */
export async function downloadProposal(estimateId: string, validDays: number = 30): Promise<boolean> {
  const data = await loadProposalData(estimateId);
  if (!data) return false;

  const proposalNumber = generateProposalNumber();
  const validUntil = new Date();
  validUntil.setDate(validUntil.getDate() + validDays);

  const html = generateProposalHTML(data, proposalNumber, validUntil.toISOString());

  const printWindow = window.open('', '_blank');
  if (!printWindow) return false;

  printWindow.document.write(html);
  printWindow.document.close();
  printWindow.focus();
  setTimeout(() => printWindow.print(), 500);

  return true;
}

/**
 * Convert kosztorys_estimate to offer format for Offers module
 */
export async function convertEstimateToOfferData(estimateId: string): Promise<{
  offerData: any;
  sections: any[];
} | null> {
  const data = await loadProposalData(estimateId);
  if (!data) return null;

  // Group items by room
  const itemsByRoom = data.items.reduce((acc: any, item: any) => {
    const room = item.room_group || item.room_name || 'Inne';
    if (!acc[room]) acc[room] = [];
    acc[room].push(item);
    return acc;
  }, {});

  // Build sections
  const sections = Object.entries(itemsByRoom).map(([room, items]: [string, any], sIndex: number) => ({
    id: `kosztorys-section-${sIndex}`,
    offer_id: '',
    name: room,
    description: '',
    sort_order: sIndex,
    created_at: '',
    updated_at: '',
    isExpanded: true,
    items: (items as any[]).map((item: any, iIndex: number) => {
      // Build components from work and material data
      const components: any[] = [];
      if (item.unit_price_work && item.unit_price_work > 0) {
        components.push({
          type: 'labor',
          name: item.task_description || item.work_name || 'Robocizna',
          code: item.work_code || '',
          unit: item.unit || 'szt.',
          quantity: item.quantity || 1,
          unit_price: item.unit_price_work,
          total_price: item.total_work || (item.quantity || 1) * item.unit_price_work,
        });
      }
      if (item.material_name && item.unit_price_material && item.unit_price_material > 0) {
        components.push({
          type: 'material',
          name: item.material_name,
          code: '',
          unit: item.unit || 'szt.',
          quantity: item.quantity || 1,
          unit_price: item.unit_price_material,
          total_price: item.total_material || (item.quantity || 1) * item.unit_price_material,
        });
      }
      const totalPrice = item.total_item || item.total_price || ((item.total_work || 0) + (item.total_material || 0));
      const unitPrice = item.unit_price || (item.quantity ? totalPrice / item.quantity : 0);
      return {
        id: `kosztorys-item-${sIndex}-${iIndex}`,
        offer_id: '',
        section_id: `kosztorys-section-${sIndex}`,
        name: item.task_description || item.work_name || item.installation_element || item.work_code || `Pozycja ${iIndex + 1}`,
        description: item.installation_element || item.work_code || '',
        quantity: item.quantity,
        unit: item.unit,
        unit_price: unitPrice,
        total_price: totalPrice,
        sort_order: iIndex,
        is_optional: false,
        created_at: '',
        updated_at: '',
        isNew: true,
        components,
      };
    }),
  }));

  // Add equipment as separate section
  if (data.equipment.length > 0) {
    sections.push({
      id: 'kosztorys-equipment-section',
      offer_id: '',
      name: 'Sprzęt i urządzenia',
      description: '',
      sort_order: sections.length,
      created_at: '',
      updated_at: '',
      isExpanded: true,
      items: data.equipment.map((eq: any, eIndex: number) => ({
        id: `kosztorys-eq-${eIndex}`,
        offer_id: '',
        section_id: 'kosztorys-equipment-section',
        name: eq.equipment_name || eq.equipment_code || `Sprzęt ${eIndex + 1}`,
        description: eq.equipment_code || '',
        quantity: eq.quantity,
        unit: eq.unit,
        unit_price: eq.unit_price,
        total_price: eq.total_price,
        sort_order: eIndex,
        is_optional: false,
        created_at: '',
        updated_at: '',
        isNew: true,
        components: [],
      })),
    });
  }

  return {
    offerData: {
      name: `Oferta - ${data.request?.investment_name || 'Kosztorys'}`,
      project_id: '',
      client_id: '',
      valid_until: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
      discount_percent: data.totals.discountPercent,
      discount_amount: data.totals.discountAmount,
      notes: '',
      internal_notes: `Importowano z kosztorysu ID: ${estimateId}`,
    },
    sections,
  };
}
