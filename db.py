import os
import boto3
from pydantic import BaseModel
from botocore.exceptions import ClientError

DB_ACCESS_KEY_ID = os.environ.get('DB_ACCESS_KEY_ID')
DB_SECRET_ACCESS_KEY = os.environ.get('DB_SECRET_ACCESS_KEY')
USER_STORAGE_URL = os.environ.get('USER_STORAGE_URL')

class User(BaseModel):
    user_id: str

def getUser(user_id, dynamodb=None):
    if not dynamodb:
        dynamodb = boto3.resource(
                'dynamodb',
                endpoint_url=USER_STORAGE_URL,
                region_name = 'us-east-1',
                aws_access_key_id = DB_ACCESS_KEY_ID,
                aws_secret_access_key = DB_SECRET_ACCESS_KEY
                )
    table = dynamodb.Table('Users')
    try:
        response = table.get_item(Key={'user_id': str(user_id)})
    except ClientError as e:
        print(e.response['Error']['Message'])
    else:
        return getattr(response, 'Item', None)
    
def getUsers(dynamodb=None):
    if not dynamodb:
        dynamodb = boto3.resource(
                'dynamodb',
                endpoint_url=USER_STORAGE_URL,
                region_name = 'us-east-1',
                aws_access_key_id = DB_ACCESS_KEY_ID,
                aws_secret_access_key = DB_SECRET_ACCESS_KEY
                )
    table = dynamodb.Table('Users')
    try:
        response = table.scan()
    except ClientError as e:
        print(e.response['Error']['Message'])
    else:
        users = []
        for item in response['Items']:
            users.append(User(**item))
        print(users)
        return users

def createUser(userId, dynamodb=None):
    if not dynamodb:
        dynamodb = boto3.resource(
                'dynamodb',
                endpoint_url=USER_STORAGE_URL,
                region_name = 'us-east-1',
                aws_access_key_id = DB_ACCESS_KEY_ID,
                aws_secret_access_key = DB_SECRET_ACCESS_KEY
                )
        print("connection is recreated")

    table = dynamodb.Table('Users')
    response = table.put_item(
        Item={
        'user_id': str(userId),
        }
    )
    print(response)
    return response

def removeUser(userId, dynamodb=None):
    if not dynamodb:
        dynamodb = boto3.resource(
                'dynamodb',
                endpoint_url=USER_STORAGE_URL,
                region_name = 'us-east-1',
                aws_access_key_id = DB_ACCESS_KEY_ID,
                aws_secret_access_key = DB_SECRET_ACCESS_KEY
                )

    table = dynamodb.Table('Users')
    response = table.delete_item(Key={'user_id': str(userId)})
    return response

def create_user_table():
    dynamodb = boto3.resource(
        'dynamodb',
        endpoint_url=USER_STORAGE_URL,
        region_name = 'us-east-1',
        aws_access_key_id = DB_ACCESS_KEY_ID,
        aws_secret_access_key = DB_SECRET_ACCESS_KEY
        )
    table = dynamodb.create_table(
        TableName = 'Users',
        KeySchema=[
            {
                'AttributeName': 'user_id',
                'KeyType': 'HASH' # Partition key
            }
        ],
        AttributeDefinitions=[
            {'AttributeName': 'user_id', 'AttributeType': 'S'}
        ]
    )
    return table