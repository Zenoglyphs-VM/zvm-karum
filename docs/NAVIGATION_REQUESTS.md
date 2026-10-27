# Collection requests across navigation

Collection reads capture a validated route address and the current request
generation before awaiting HTTP or royalty metadata. After an await, only the
still-current route may publish results or launch dependent reads. Unmount
invalidates the generation and detaches the block listener. Item pagination,
side listings/offers, tab sales/activity and block refresh use the same fence.

This keeps late collection work from launching requests with the next page's
parameters or replacing its state. The real Chrome/Go HTTP regression checks
canonical collection-to-item navigation and requires no page HTTP failures.
Its prior run retained three 400 responses from collection side endpoints.
This change does not alter order inputs, signing, settlement or API schemas.

An invalid collection route clears prior collection/item/side data, completes
loading and shows an explicit address error without sending a malformed API
request. The browser history regression starts on a valid collection, changes
its address to an invalid value in the same application, checks that the old
item card is gone, and returns to the valid item. Late responses retain the
same generation fence.
