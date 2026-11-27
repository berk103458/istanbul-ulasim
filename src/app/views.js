import { createNearbyView } from "../views/nearbyView.js";

function lazyView(create) {
  let instance;
  let pending;

  return {
    async get() {
      if (instance) return instance;
      pending ??= create().then((view) => {
        instance = view;
        return view;
      });
      return pending;
    },
    peek: () => instance,
  };
}

export function createViews(S, mc, callbacks) {
  return {
    nearbyView: createNearbyView(S, mc, callbacks),
    modal: lazyView(() => import("../views/stopModal.js").then((m) => m.createStopModal(S, mc, callbacks))),
    routeView: lazyView(() => import("../views/routeView.js").then((m) => m.createRouteView(S, mc, callbacks))),
    busView: lazyView(() => import("../views/busView.js").then((m) => m.createBusView(S, mc, callbacks))),
    railView: lazyView(() => import("../views/railView.js").then((m) => m.createRailView(S, mc, callbacks))),
    ferryView: lazyView(() => import("../views/ferryView.js").then((m) => m.createFerryView(S, mc, callbacks))),
  };
}
