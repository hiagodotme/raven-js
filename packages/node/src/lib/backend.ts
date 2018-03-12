import {
  Backend,
  Breadcrumb,
  Context,
  Frontend,
  Options,
  SentryError,
  SentryEvent,
} from '@sentry/core';
import { forget } from '@sentry/utils';
import { Raven, SendMethod } from './raven';

/** Original Raven send function. */
const sendRavenEvent = Raven.send.bind(Raven) as SendMethod;

/**
 * Configuration options for the Sentry Node SDK.
 * @see NodeFrontend for more information.
 */
export interface NodeOptions extends Options {
  /**
   * Whether unhandled Promise rejections should be captured or not. If true,
   * this will install an error handler and prevent the process from crashing.
   * Defaults to false.
   */
  captureUnhandledRejections?: boolean;
}

/** The Sentry Node SDK Backend. */
export class NodeBackend implements Backend {
  /** Handle to the SDK frontend for callbacks. */
  private readonly frontend: Frontend<NodeOptions>;
  /** In memory store for breadcrumbs. */
  private breadcrumbs: Breadcrumb[] = [];
  /** In memory store for context infos. */
  private context: Context = {};

  /** Creates a new Node backend instance. */
  public constructor(frontend: Frontend<NodeOptions>) {
    this.frontend = frontend;
  }

  /**
   * @inheritDoc
   */
  public async install(): Promise<boolean> {
    // We are only called by the frontend if the SDK is enabled and a valid DSN
    // has been configured. If no DSN is present, this indicates a programming
    // error.
    const dsn = this.frontend.getDSN();
    if (!dsn) {
      throw new SentryError(
        'Invariant exception: install() must not be called when disabled',
      );
    }

    Raven.config(dsn.toString(), this.frontend.getOptions()).install();

    // Hook into Raven's breadcrumb mechanism. This allows us to intercept
    // both breadcrumbs created internally by Raven and pass them to the
    // Frontend first, before actually capturing them.
    Raven.captureBreadcrumb = breadcrumb => {
      forget(this.frontend.addBreadcrumb(breadcrumb));
    };

    // Hook into Raven's internal event sending mechanism. This allows us to
    // pass events to the frontend, before they will be sent back here for
    // actual submission.
    Raven.send = event => {
      forget(this.frontend.captureEvent(event));
    };

    return true;
  }

  /**
   * @inheritDoc
   */
  public async storeContext(context: Context): Promise<void> {
    this.context = { ...context };
  }

  /**
   * @inheritDoc
   */
  public async loadContext(): Promise<Context> {
    return this.context;
  }

  /**
   * @inheritDoc
   */
  public async sendEvent(event: SentryEvent): Promise<number> {
    return new Promise<number>(resolve => {
      sendRavenEvent(event, error => {
        // TODO: Check the response status code
        resolve(error ? 500 : 200);
      });
    });
  }

  /**
   * @inheritDoc
   */
  public async storeBreadcrumbs(breadcrumbs: Breadcrumb[]): Promise<void> {
    this.breadcrumbs = [...breadcrumbs];
  }

  /**
   * @inheritDoc
   */
  public async loadBreadcrumbs(): Promise<Breadcrumb[]> {
    return [...this.breadcrumbs];
  }
}
