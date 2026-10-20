/**
 * Mobile Wallet Utilities for Apple Wallet (.pkpass) and Google Wallet
 */

export function generateApplePassData({ order, ticket, event }) {
    const origin = typeof window !== 'undefined' ? window.location.origin : 'https://ticketlite.ca';
    const ticketId = ticket?.ticketId || `${order.orderId}-01`;
    const checkinUrl = `${origin}/tickets/${order.orderId}?ticketId=${ticketId}&checkin=1`;
    const shareUrl = `${origin}/tickets/${order.orderId}?ticketId=${ticketId}`;

    return {
        formatVersion: 1,
        passTypeIdentifier: 'pass.com.vtix.ticket',
        serialNumber: ticketId,
        teamIdentifier: 'TICKETLITE_TEAM_ID',
        organizationName: 'Ticket Lite',
        description: `${order.eventTitle} Admission Pass`,
        logoText: 'TICKET LITE',
        foregroundColor: 'rgb(255, 255, 255)',
        backgroundColor: 'rgb(15, 23, 42)',
        labelColor: 'rgb(148, 163, 184)',
        barcodes: [
            {
                format: 'PKBarcodeFormatQR',
                message: checkinUrl,
                messageEncoding: 'iso-8859-1',
                altText: ticketId
            }
        ],
        eventTicket: {
            headerFields: [
                {
                    key: 'order',
                    label: 'ORDER',
                    value: `#${order.orderId}`
                }
            ],
            primaryFields: [
                {
                    key: 'event',
                    label: 'EVENT',
                    value: order.eventTitle
                }
            ],
            secondaryFields: [
                {
                    key: 'tier',
                    label: 'ADMISSION',
                    value: ticket?.name || 'General Admission'
                },
                {
                    key: 'date',
                    label: 'DATE & TIME',
                    value: event?.date || 'Event Date TBA'
                }
            ],
            auxiliaryFields: [
                {
                    key: 'venue',
                    label: 'VENUE',
                    value: event?.location || 'Venue TBA'
                },
                {
                    key: 'passId',
                    label: 'PASS ID',
                    value: ticketId
                }
            ],
            backFields: [
                {
                    key: 'ticketUrl',
                    label: 'ONLINE TICKET PASS',
                    value: shareUrl
                },
                {
                    key: 'status',
                    label: 'STATUS',
                    value: ticket?.checkInStatus === 'checked_in' ? 'Checked In' : 'Valid for Entry'
                },
                {
                    key: 'terms',
                    label: 'TERMS & CONDITIONS',
                    value: 'Present this pass at venue entrance for scanning. Each pass is single-use and invalid once scanned.'
                }
            ]
        }
    };
}

export function generateGoogleWalletPassData({ order, ticket, event }) {
    const origin = typeof window !== 'undefined' ? window.location.origin : 'https://ticketlite.ca';
    const ticketId = ticket?.ticketId || `${order.orderId}-01`;
    const checkinUrl = `${origin}/tickets/${order.orderId}?ticketId=${ticketId}&checkin=1`;

    return {
        class: {
            id: `vtix_class_${order.eventId || 'event'}`,
            issuerName: 'Ticket Lite',
            eventName: {
                defaultValue: {
                    language: 'en',
                    value: order.eventTitle
                }
            },
            venue: {
                name: {
                    defaultValue: {
                        language: 'en',
                        value: event?.location || 'Venue'
                    }
                }
            },
            dateTime: {
                start: event?.date || new Date().toISOString()
            },
            reviewStatus: 'UNDER_REVIEW'
        },
        object: {
            id: `vtix_object_${ticketId}`,
            classId: `vtix_class_${order.eventId || 'event'}`,
            state: ticket?.checkInStatus === 'checked_in' ? 'USED' : 'ACTIVE',
            ticketNumber: ticketId,
            ticketType: {
                defaultValue: {
                    language: 'en',
                    value: ticket?.name || 'General Admission'
                }
            },
            barcode: {
                type: 'QR_CODE',
                value: checkinUrl,
                alternateText: ticketId
            }
        }
    };
}

/**
 * Downloads the pass.json file for inspect or offline signing
 */
export function downloadPassJson(passData, filename = 'pass.json') {
    const dataStr = 'data:text/json;charset=utf-8,' + encodeURIComponent(JSON.stringify(passData, null, 2));
    const downloadAnchor = document.createElement('a');
    downloadAnchor.setAttribute('href', dataStr);
    downloadAnchor.setAttribute('download', filename);
    document.body.appendChild(downloadAnchor);
    downloadAnchor.click();
    document.body.removeChild(downloadAnchor);
}
