import AWS, { AWSError, DynamoDB } from 'aws-sdk';
import * as R from 'ramda';
import { CreateTableOutput, CreateTableInput, DescribeTableInput, DescribeTableOutput } from 'aws-sdk/clients/dynamodb';
import { PromiseResult } from 'aws-sdk/lib/request';
import { Option, some, none } from 'fp-ts/lib/Option';

const ddbclient = new AWS.DynamoDB({
  accessKeyId: 'foobar',
  endpoint: 'http://localhost:8000',
  region: 'ap-southeast-2',
});

interface ICollection {
  initialize(params: any): void;
}

abstract class GenericCollection {
  protected documentClient: AWS.DynamoDB.DocumentClient;
  protected defaultCreateTableParams = {
    AttributeDefinitions: [
      {
        AttributeName: 'id',
        AttributeType: 'S',
      },
      {
        AttributeName: 'meta_name',
        AttributeType: 'S',
      },
      {
        AttributeName: 'meta_order',
        AttributeType: 'S',
      },
      /* more items */
    ],
    BillingMode: 'PAY_PER_REQUEST',
    KeySchema: [
      {
        AttributeName: 'id',
        KeyType: 'HASH',
      },
    ],
    SSESpecification: {
      Enabled: true,
    },
  };

  constructor(protected client: AWS.DynamoDB, protected name: string, protected tableName: string = 'collections') {
    this.documentClient = new AWS.DynamoDB.DocumentClient(this.client.config);
  }

  public async details(): Promise<PromiseResult<DescribeTableOutput, AWSError>> {
    return await this.client.describeTable({ TableName: this.tableName } as DescribeTableInput).promise();
  }

  public async initialize(params: CreateTableInput): Promise<PromiseResult<CreateTableOutput, AWSError>> {
    try {
      const res = await this.client.createTable(params).promise();
      return res;
    } catch (err) {
      return err;
    }
  }

  protected tableAsParam(): { TableName: DynamoDB.TableName } {
    return {
      TableName: this.tableName,
    };
  }
}

interface StackItem<T> {
  id: string;
  meta_name: string;
  meta_order: string;
  tag: string;
  value: T;
}

/* tslint:disable max-classes-per-file */
class Stack<T> extends GenericCollection implements ICollection {
  public get(): T {
    return {} as T;
  }

  public async initialize(extraParams?: CreateTableInput): Promise<PromiseResult<CreateTableOutput, AWSError>> {
    const tableParams = R.mergeAll([
      this.defaultCreateTableParams as CreateTableInput,
      super.tableAsParam(),
      {
        GlobalSecondaryIndexes: [
          {
            IndexName: `${this.name}-sorted`,
            KeySchema: [
              {
                AttributeName: 'meta_name',
                KeyType: 'HASH',
              },
              {
                AttributeName: 'meta_order',
                KeyType: 'RANGE',
              },
            ],
            Projection: {
              ProjectionType: 'KEYS_ONLY',
            },
            ProvisionedThroughput: {
              ReadCapacityUnits: 0,
              WriteCapacityUnits: 0,
            },
          },
        ],
      },
      extraParams,
    ]);

    if (!tableParams) {
      throw new Error('No initialization parameters specified');
    }

    return await super.initialize(tableParams as CreateTableInput);
  }

  public async push(item: T, tag: string): Promise<void> {
    const ts = `${Date.now()}`;
    await this.documentClient
      .put({
        ...super.tableAsParam(),
        Item: {
          meta_name: `${this.name}`,
          meta_order: `${ts}`,
          id: `${this.name}@${ts}`,
          tag: `${tag}`,
          value: item,
        },
      })
      .promise();
  }

  public async top(): Promise<StackItem<T> | null> {
    const res = await this.seek(false, 1);
    return res.toNullable();
  }

  public async bottom(): Promise<StackItem<T> | null> {
    const res = await this.seek(true, 1);
    return res.toNullable();
  }

  public async pop(): Promise<any> {
    const res = await this.seek(false, 1);
    res.map(i => this._delete_id(i.id));
  }

  private async _get_id(id: string): Promise<StackItem<T>> {
    const d = await this.documentClient
      .get({
        ...super.tableAsParam(),
        Key: {
          id,
        },
      })
      .promise();

    return d.Item as StackItem<T>;
  }

  private async _delete_id(id: string): Promise<void> {
    console.log('>>> delete_id', id);
  }

  private async seek(forward: boolean = true, limit: number = 1): Promise<Option<StackItem<T>>> {
    const res = await this.documentClient
      .query({
        ...super.tableAsParam(),
        ExpressionAttributeValues: {
          ':id': this.name,
          ':sk': `${Date.now()}`,
        },
        IndexName: `${this.name}-sorted`,
        KeyConditionExpression: 'meta_name = :id and meta_order <= :sk',
        Limit: limit,
        ReturnConsumedCapacity: 'TOTAL',
        ScanIndexForward: forward,
      })
      .promise();

    if (!res.Items || res.Items.length < 1) return none;

    const item = res.Items[0] as StackItem<T>;
    return some(await this._get_id(item.id));
  }
}

const s = new Stack<number>(ddbclient, 'myStack');

(async () => {
  // console.log('>>> initializing');
  // try {
  //   const res = await s.initialize();
  //   console.log(res);
  // } catch (err) {
  //   console.log(err);
  // }

  // console.log(await s.initialize());
  // console.log(await s.details());

  // for (let i = 0; i < 15; ++i) {
  //   await s.push(i, `MyTag-${i}`);
  // }

  console.log(await s.top());
  console.log(await s.bottom());
  // console.log(await s.query('Item-1'));
})();

export default Stack;
